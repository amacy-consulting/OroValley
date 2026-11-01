"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require("electron");

const sources = require("./engine/sources");
const { cleanupTemp } = require("./engine/media");
const transcripts = require("./engine/transcripts");
const { summarizeClip, obtainTranscript } = require("./engine/pipeline");
const { draftMinutes } = require("./engine/minutesPipeline");
const minutesStore = require("./engine/minutesStore");
const exporter = require("./engine/export");
const { ReviewStore } = require("./engine/review");
const { FriendlyError, CancelledError, isAbortError } = require("./engine/errors");
const { loadSettings, saveSettings, publicSettings } = require("./engine/settings");
const { Corpus } = require("./engine/corpus");
const searchEngine = require("./engine/search");
const { TopicStore, topicStats, topicsForMeeting, topicsOverview } = require("./engine/topics");
const { askQuestion } = require("./engine/ask");
const { JobQueue } = require("./engine/jobs");
const { loadCouncilRoster } = require("./engine/roster");

let mainWindow = null;
let store = null;
let corpus = null; // every saved transcript, summary and minutes draft, for search, topics and questions
let topics = null; // watched keywords (TopicStore)
let jobs = null; // the bulk queue (JobQueue)
let busy = false;
let queueHoldsBusy = false; // true while the bulk queue is the long-running thing
let currentJob = null; // { controller, id, kind } while a summary, transcript, minutes or ask job runs
let listingCache = null; // { at, meetings }
const clipCache = new Map(); // meeting id -> resolved Swagit clip, for the session
const publishedMinutesCache = new Map(); // minutesSeq -> text
const LISTING_TTL_MS = 10 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASKS_KEEP = 50; // questions and answers remembered in userData/asks.json
const COUNCIL_KINDS = ["council", "special", "work-session"];
const DEEPGRAM_PER_MINUTE = 0.0043; // Nova-3, per the Settings screen
const UNKNOWN_DURATION_MIN = 150; // used for the estimate when Swagit has not reported a length

/** Bundled files (keyterms.txt, sample minutes): next to app.asar when packaged, review-app/resources in development. */
function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

/** Transcripts and draft minutes go to Documents\Oro Valley Minutes, so a
 *  meeting is transcribed (and paid for) once and the Clerk's files are easy to find. */
function outputDir() {
  // OV_DOCUMENTS points tests and screenshots at a scratch Documents folder.
  return process.env.OV_DOCUMENTS
    ? path.join(process.env.OV_DOCUMENTS, "Oro Valley Minutes")
    : path.join(app.getPath("documents"), "Oro Valley Minutes");
}

function tempDir() {
  return path.join(app.getPath("temp"), "ov-minutes");
}

function transcriptsDir() {
  return path.join(outputDir(), "Transcripts");
}

function minutesDir() {
  return minutesStore.minutesDir(outputDir());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 620,
    title: "Oro Valley Council Dashboard",
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));

  // Links (including ones inside the preview) open in the browser, never in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Dev helper: OV_SCREENSHOT=<file.png> captures the window and exits.
  if (process.env.OV_SCREENSHOT) {
    mainWindow.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.OV_SCREENSHOT_DELAY) || 2500));
      // OV_SCREENSHOT_CLICK="<css selector>|<css selector>…" clicks those in order first
      // (for example the first meeting, then its Transcript tab).
      for (const selector of (process.env.OV_SCREENSHOT_CLICK || "").split("|").filter(Boolean)) {
        await mainWindow.webContents.executeJavaScript(
          `[...document.querySelectorAll(${JSON.stringify(selector.replace(/:text\(.*\)$/, ""))})]` +
            `.find((el) => ${JSON.stringify((selector.match(/:text\((.*)\)$/) || [])[1] || "")} === "" || el.textContent.trim() === ${JSON.stringify((selector.match(/:text\((.*)\)$/) || [])[1] || "")})?.click()`
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      // OV_SCREENSHOT_TYPE="<css selector>=<text>" then types into that field the way a
      // person would (React sees the change) and presses Enter.
      const typeStep = process.env.OV_SCREENSHOT_TYPE || "";
      const eq = typeStep.indexOf("=");
      if (eq > 0) {
        await mainWindow.webContents.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(typeStep.slice(0, eq))});
            if (!el) return false;
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
            el.focus();
            setter.call(el, ${JSON.stringify(typeStep.slice(eq + 1))});
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            return true;
          })()`
        );
        await new Promise((r) => setTimeout(r, 1500));
      }
      // OV_SCREENSHOT_AFTER="<css selector>|…" clicks more things after typing (for example a result).
      for (const selector of (process.env.OV_SCREENSHOT_AFTER || "").split("|").filter(Boolean)) {
        await mainWindow.webContents.executeJavaScript(
          `[...document.querySelectorAll(${JSON.stringify(selector.replace(/:text\(.*\)$/, ""))})]` +
            `.find((el) => ${JSON.stringify((selector.match(/:text\((.*)\)$/) || [])[1] || "")} === "" || el.textContent.trim() === ${JSON.stringify((selector.match(/:text\((.*)\)$/) || [])[1] || "")})?.click()`
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.OV_SCREENSHOT, image.toPNG());
      app.quit();
    });
  }
}

function progress(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("progress", message);
}

async function getListing({ force = false, signal } = {}) {
  if (!force && listingCache && Date.now() - listingCache.at < LISTING_TTL_MS) return listingCache.meetings;
  const meetings = await sources.listMeetings({ signal });
  listingCache = { at: Date.now(), meetings };
  return meetings;
}

/** Look a clip id up in an index map whether it was keyed as a number or a string. */
function lookup(index, clipId) {
  if (clipId == null || clipId === "") return null;
  return index.get(clipId) || index.get(Number(clipId)) || index.get(String(clipId)) || null;
}

/** "On file" details for a saved transcript or minutes file, or null. */
function fileInfo(index, clipId) {
  const file = lookup(index, clipId);
  if (!file) return null;
  let savedAt = null;
  try {
    savedAt = new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    /* removed between listing and stat */
  }
  return { name: path.basename(file), savedAt };
}

function safeIndex(fn) {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return new Map();
  }
}

function snapshot() {
  const view = store.view();
  const tIndex = safeIndex(() => transcripts.indexTranscripts(transcriptsDir()));
  const mIndex = safeIndex(() => minutesStore.indexMinutes(minutesDir()));
  return {
    ...view,
    meetings: view.meetings.map((m) => ({
      ...m,
      transcript: fileInfo(tIndex, m.clipId),
      minutes: fileInfo(mIndex, m.clipId),
    })),
    settings: publicSettings(),
    job: currentJob ? { id: currentJob.id, kind: currentJob.kind } : null,
    jobs: jobs ? jobs.status() : { running: null, pending: [], done: [] },
  };
}

/** Turn an error into what the screen shows. */
function failure(e) {
  if (e instanceof FriendlyError) {
    return { ok: false, error: e.message, cancelled: e.cancelled, needsSettings: e.needsKey, keyKind: e.keyKind };
  }
  console.error(e);
  return { ok: false, error: e.message || String(e) };
}

/** Run a long action once at a time. */
async function run(action) {
  if (busy) return { ok: false, error: "Another action is still running. Wait for it to finish." };
  busy = true;
  try {
    return { ok: true, ...(await action()) };
  } catch (e) {
    return failure(e);
  } finally {
    busy = false;
    progress("");
  }
}

function meetingFor(id) {
  const meeting = store.view().meetings.find((m) => m.id === id);
  if (!meeting) throw new FriendlyError("That meeting is no longer in the list. Click Check for new meetings.");
  return meeting;
}

/** The Swagit clip for a meeting, from the listing or the video page. Cached for the session. */
async function clipFor(meeting, { signal, fresh = false } = {}) {
  if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video.");
  if (!fresh && clipCache.has(meeting.id)) return { ...clipCache.get(meeting.id) };
  let listing = null;
  try {
    listing = await getListing({ signal });
  } catch {
    listing = null; // the video page alone is enough
  }
  const clip = await sources.resolveClip(meeting.clipId, { listing, signal });
  clipCache.set(meeting.id, clip);
  return { ...clip };
}

/** A clip with the reviewer's date and title applied, for files and prompts. */
function withDraft(clip, fields) {
  const out = { ...clip };
  if (fields && DATE.test(String(fields.date || ""))) out.date = fields.date; // the reviewer's date wins
  return out;
}

/** What saveMinutes and the file names need, without touching the network. */
function clipLike(meeting) {
  const s = meeting.source || {};
  return {
    ...s,
    clipId: meeting.clipId,
    title: s.title || meeting.draft.title || "Town Council Meeting",
    date: DATE.test(String(meeting.draft.date || "")) ? meeting.draft.date : s.date || null,
  };
}

/** A cancellable job: one at a time, shares the Cancel button with every other long job. */
async function withJob(id, kind, work) {
  const controller = new AbortController();
  currentJob = { controller, id, kind };
  try {
    return await work(controller.signal);
  } catch (e) {
    // A cancel can surface as a raw AbortError from a body read; report it as a cancel.
    if (controller.signal.aborted || isAbortError(e)) throw new CancelledError();
    throw e;
  } finally {
    currentJob = null;
  }
}

function keysAndDirs() {
  const settings = loadSettings();
  return {
    keys: { anthropic: settings.anthropicApiKey, deepgram: settings.deepgramApiKey },
    dirs: { output: outputDir(), temp: tempDir(), reference: resourcesDir() },
  };
}

ipcMain.handle("state:get", () => snapshot());

ipcMain.handle("meetings:refresh", () =>
  run(async () => {
    const listing = { listMeetings: () => getListing({ force: true }) };
    const result = await store.refresh({ sources: listing, onProgress: progress });
    clipCache.clear();
    return { ...result, state: snapshot() };
  })
);

/** Quick edits to the review state. Refused while a long action runs, so the
 *  state does not change under a job that is reading it. */
function edit(change) {
  if (busy) return { ok: false, error: "Wait for the current action to finish, then try again." };
  try {
    change();
    return { ok: true, state: snapshot() };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
}

ipcMain.handle("meeting:save", (_e, id, fields) => edit(() => store.update(id, fields)));
/** status: "active" | "hidden" */
ipcMain.handle("meeting:status", (_e, id, status) => edit(() => store.setStatus(id, status)));

/* ---- The three long jobs, shared by the single-meeting buttons and the bulk queue ---- */

/** Transcribe one meeting: Swagit video -> Deepgram -> saved file. */
async function transcribeMeeting(meeting, { retranscribe = false, signal, report }) {
  if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to transcribe.");
  report("Looking up the video on Swagit…");
  const clip = withDraft(await clipFor(meeting, { signal }), meeting.draft);
  const result = await obtainTranscript({
    clip,
    retranscribe: Boolean(retranscribe),
    ...keysAndDirs(),
    report: (text) => report(text),
    signal,
  });
  return {
    transcriptReused: Boolean(result.reused),
    transcriptSource: result.source || null,
    name: result.txtPath ? path.basename(result.txtPath) : null,
  };
}

/** Write one meeting's summary: Swagit video -> transcript -> Claude. `draft` is the reviewer's current text. */
async function summarizeMeeting(meeting, { draft, retranscribe = false, signal, report }) {
  if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to summarize.");
  report("Looking up the video on Swagit…");
  const fields = draft && typeof draft === "object" ? draft : meeting.draft;
  const clip = withDraft(await clipFor(meeting, { signal }), fields);
  const result = await summarizeClip({
    clip,
    draft: fields,
    retranscribe: Boolean(retranscribe),
    ...keysAndDirs(),
    onProgress: (p) => report(p.text),
    signal,
  });
  return {
    suggestion: { overview: result.overview, details: result.details },
    transcriptReused: result.transcriptReused,
    agendaUsed: result.agendaUsed,
  };
}

/** Draft one meeting's minutes: transcript + agenda + the sample minutes -> Claude -> saved markdown. */
async function draftMeetingMinutes(meeting, { currentMarkdown, retranscribe = false, signal, report }) {
  if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to draft minutes from.");
  report("Looking up the video on Swagit…");
  const clip = withDraft(await clipFor(meeting, { signal }), meeting.draft);
  // `draft` is the Clerk's current Markdown (a redraft keeps their edits), or null for a first draft.
  const current = typeof currentMarkdown === "string" ? currentMarkdown.trim() : "";
  const result = await draftMinutes({
    clip,
    draft: current || null,
    retranscribe: Boolean(retranscribe),
    ...keysAndDirs(),
    onProgress: (p) => report(typeof p === "string" ? p : p && p.text),
    signal,
  });
  return {
    minutes: result.minutes,
    notes: Array.isArray(result.notes) ? result.notes : [],
    transcriptReused: Boolean(result.transcriptReused),
    agendaUsed: Boolean(result.agendaUsed),
    sampleUsed: Boolean(result.sampleUsed),
    savedPath: result.savedPath || null,
  };
}

/** Write (or rewrite) one meeting's summary: Swagit video -> transcript -> Claude. */
ipcMain.handle("meeting:summarize", (_e, id, draft, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    return withJob(id, "summary", async (signal) => {
      const result = await summarizeMeeting(meeting, {
        draft,
        retranscribe: Boolean(options && options.retranscribe),
        signal,
        report: progress,
      });
      currentJob = null;
      return { ...result, state: snapshot() };
    });
  })
);

/** Transcribe a meeting without writing anything else: Swagit video -> Deepgram -> saved file. */
ipcMain.handle("transcript:create", (_e, id, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    return withJob(id, "transcript", async (signal) => {
      const result = await transcribeMeeting(meeting, {
        retranscribe: Boolean(options && options.retranscribe),
        signal,
        report: progress,
      });
      currentJob = null;
      return { ...result, state: snapshot() };
    });
  })
);

/** Draft (or redraft) the minutes: transcript + agenda + the sample minutes -> Claude -> saved markdown. */
ipcMain.handle("minutes:draft", (_e, id, currentMarkdown, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    return withJob(id, "minutes", async (signal) => {
      const result = await draftMeetingMinutes(meeting, {
        currentMarkdown,
        retranscribe: Boolean(options && options.retranscribe),
        signal,
        report: progress,
      });
      currentJob = null;
      return { ...result, state: snapshot() };
    });
  })
);

ipcMain.handle("meeting:cancel", () => {
  if (!currentJob) return { ok: false };
  currentJob.controller.abort();
  return { ok: true };
});

/** The saved transcript file for a meeting, or null. Only files in the app's own Transcripts folder. */
function transcriptFor(id) {
  const meeting = store.view().meetings.find((m) => m.id === id);
  return meeting && meeting.clipId ? transcripts.findTranscript(transcriptsDir(), meeting.clipId) : null;
}

/** The transcript for the in-app viewer: header lines, body, and the Swagit player link. */
ipcMain.handle("transcript:read", (_e, id) => {
  const file = transcriptFor(id);
  if (!file) return { ok: false, error: "No transcript is saved for this meeting yet." };
  try {
    const meeting = store.view().meetings.find((m) => m.id === id);
    const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
    const rule = lines.indexOf("----");
    const header = rule >= 0 ? lines.slice(0, rule).filter(Boolean) : [];
    const body = (rule >= 0 ? lines.slice(rule + 1) : lines).join("\n").trim();
    const nameM = path.basename(file).match(/\((?:video|clip) (\d+)\)\.txt$/i);
    const clipId = (meeting && meeting.clipId) || (nameM ? Number(nameM[1]) : null);
    return {
      ok: true,
      name: path.basename(file),
      path: file,
      header,
      body,
      clipId,
      playerUrl: clipId ? sources.playerUrl(clipId) : null,
      // Per-timestamp links are playBase + "#" + seconds.
      playBase: clipId ? sources.playerUrl(clipId) : null,
    };
  } catch (e) {
    return { ok: false, error: `The transcript could not be read (${e.message || e}).` };
  }
});

ipcMain.handle("transcript:open", async (_e, id) => {
  const file = transcriptFor(id);
  if (!file) return { ok: false, error: "No transcript is saved for this meeting yet." };
  const err = await shell.openPath(file);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle("transcript:showInFolder", (_e, id) => {
  const file = transcriptFor(id);
  if (!file) return { ok: false };
  shell.showItemInFolder(file);
  return { ok: true };
});

/** The saved minutes draft (markdown) for a meeting, or null. */
function minutesFor(id) {
  const meeting = store.view().meetings.find((m) => m.id === id);
  return meeting && meeting.clipId ? minutesStore.findMinutes(minutesDir(), meeting.clipId) : null;
}

ipcMain.handle("minutes:read", (_e, id) => {
  const meeting = store.view().meetings.find((m) => m.id === id);
  const s = (meeting && meeting.source) || {};
  const file = minutesFor(id);
  if (!file) {
    return {
      ok: false,
      none: true,
      error: "No draft minutes are saved for this meeting yet.",
      publishedMinutesUrl: s.minutesUrl || null,
      hasPublished: Boolean(s.minutesSeq),
    };
  }
  try {
    const doc = minutesStore.readMinutes(file);
    return {
      ok: true,
      markdown: doc.markdown || "",
      notes: Array.isArray(doc.notes) ? doc.notes : [],
      savedAt: doc.savedAt || null,
      name: path.basename(file),
      path: file,
      publishedMinutesUrl: s.minutesUrl || null,
      hasPublished: Boolean(s.minutesSeq),
    };
  } catch (e) {
    return { ok: false, error: `The draft minutes could not be read (${e.message || e}).` };
  }
});

ipcMain.handle("minutes:save", (_e, id, markdown) => {
  if (busy) return { ok: false, error: "Wait for the current action to finish, then try again." };
  try {
    const meeting = meetingFor(id);
    if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video, so its minutes have nowhere to be filed.");
    let notes = [];
    const existing = minutesFor(id);
    if (existing) {
      try {
        notes = minutesStore.readMinutes(existing).notes || [];
      } catch {
        notes = [];
      }
    }
    const { mdPath } = minutesStore.saveMinutes(minutesDir(), clipLike(meeting), String(markdown || ""), { notes });
    return { ok: true, path: mdPath, name: path.basename(mdPath), savedAt: new Date().toISOString(), state: snapshot() };
  } catch (e) {
    return failure(e);
  }
});

const EXPORTS = {
  docx: { ext: ".docx", label: "Word document" },
  txt: { ext: ".txt", label: "Plain text" },
  md: { ext: ".md", label: "Markdown" },
};

/** Save the minutes as Word, text or markdown where the clerk chooses. `markdown` (optional) is the editor's current text. */
ipcMain.handle("minutes:export", async (_e, id, format, markdown) => {
  const kind = EXPORTS[format];
  if (!kind) return { ok: false, error: `Unknown export format "${format}".` };
  try {
    const meeting = meetingFor(id);
    const file = minutesFor(id);
    let text = typeof markdown === "string" ? markdown : null;
    if (text === null) {
      if (!file) throw new FriendlyError("No draft minutes are saved for this meeting yet.");
      text = minutesStore.readMinutes(file).markdown || "";
    }
    const clip = clipLike(meeting);
    const stem = file
      ? path.basename(file).replace(/\.[^.]+$/, "")
      : `${clip.date || "Undated"} ${clip.title} Minutes (video ${clip.clipId})`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `Save minutes as ${kind.label}`,
      defaultPath: path.join(minutesDir(), stem + kind.ext),
      filters: [{ name: kind.label, extensions: [kind.ext.slice(1)] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    if (format === "docx") fs.writeFileSync(filePath, await exporter.minutesToDocx(text, { clip }));
    else if (format === "txt") fs.writeFileSync(filePath, exporter.minutesToText(text), "utf-8");
    else fs.writeFileSync(filePath, text, "utf-8");
    return { ok: true, path: filePath };
  } catch (e) {
    return failure(e);
  }
});

ipcMain.handle("minutes:open", async (_e, id) => {
  const file = minutesFor(id);
  if (!file) return { ok: false, error: "No draft minutes are saved for this meeting yet." };
  const err = await shell.openPath(file);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle("minutes:showInFolder", (_e, id) => {
  const file = minutesFor(id);
  if (!file) return { ok: false };
  shell.showItemInFolder(file);
  return { ok: true };
});

/** The Town's official minutes for this meeting, as posted on the agenda system. */
ipcMain.handle("minutes:published", async (_e, id) => {
  try {
    const meeting = meetingFor(id);
    const seq = meeting.source && meeting.source.minutesSeq;
    if (!seq) return { ok: false, error: "The Town has not posted official minutes for this meeting yet." };
    if (!publishedMinutesCache.has(seq)) {
      const { text } = await sources.fetchPublishedMinutes({ minutesSeq: seq }, {});
      if (!text) return { ok: false, error: "The posted minutes could not be read." };
      publishedMinutesCache.set(seq, text);
    }
    return { ok: true, text: publishedMinutesCache.get(seq), url: meeting.source.minutesUrl || null };
  } catch (e) {
    return failure(e);
  }
});

/** The posted agenda (items, memos, packet) and the Swagit chapter index. */
ipcMain.handle("agenda:read", async (_e, id) => {
  try {
    const meeting = meetingFor(id);
    const clip = await clipFor(meeting, {});
    let agenda = null;
    let agendaError = null;
    if (clip.agendaSeq || clip.agendaUrl) {
      try {
        agenda = await sources.fetchAgenda(clip, {});
      } catch (e) {
        agendaError = e.message || String(e);
      }
    }
    return {
      ok: true,
      agenda,
      agendaError,
      agendaUrl: clip.agendaUrl || null,
      index: Array.isArray(clip.index) ? clip.index : [],
      clipId: clip.clipId,
      playerUrl: clip.playerUrl || sources.playerUrl(clip.clipId),
      playBase: sources.playerUrl(clip.clipId),
    };
  } catch (e) {
    return failure(e);
  }
});

ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

/** update: { anthropicApiKey?, deepgramApiKey? }; "" removes a key. */
ipcMain.handle("settings:save", (_e, update) => edit(() => saveSettings(update && typeof update === "object" ? update : {})));

ipcMain.handle("open:external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
});

/* ---- Search, topics, questions: the analysis side ---------------------------------- */

/** Bring the corpus up to date with the files on disk and the drafts in the review state. */
function freshCorpus() {
  corpus.refresh(store.view().meetings);
  return corpus;
}

function analysis(work) {
  try {
    return { ok: true, ...work() };
  } catch (e) {
    return failure(e);
  }
}

ipcMain.handle("search:query", (_e, text, options) =>
  analysis(() => ({ result: searchEngine.search(freshCorpus(), String(text || ""), options || {}) }))
);

ipcMain.handle("search:stats", () => analysis(() => ({ stats: freshCorpus().stats() })));

ipcMain.handle("search:speakers", (_e, id) => analysis(() => ({ speakers: searchEngine.speakerStats(freshCorpus(), id) })));

ipcMain.handle("topics:list", () => analysis(() => ({ topics: topics.list() })));
ipcMain.handle("topics:add", (_e, fields) => analysis(() => ({ topic: topics.add(fields || {}), topics: topics.list() })));
ipcMain.handle("topics:update", (_e, id, fields) =>
  analysis(() => ({ topic: topics.update(id, fields || {}), topics: topics.list() }))
);
ipcMain.handle("topics:remove", (_e, id) => analysis(() => ({ removed: topics.remove(id), topics: topics.list() })));
ipcMain.handle("topics:overview", () => analysis(() => ({ overview: topicsOverview(freshCorpus(), topics.list()) })));
ipcMain.handle("topics:stats", (_e, id, range) =>
  analysis(() => {
    const topic = topics.list().find((t) => t.id === id);
    if (!topic) throw new FriendlyError("That topic no longer exists.");
    return { stats: topicStats(freshCorpus(), topic, range || {}) };
  })
);
ipcMain.handle("topics:forMeeting", (_e, id) =>
  analysis(() => ({ topics: topicsForMeeting(freshCorpus(), topics.list(), id) }))
);

/** userData/asks.json: the last ASKS_KEEP questions with their answers and sources. */
function asksFile() {
  return path.join(app.getPath("userData"), "asks.json");
}

function readAsks() {
  try {
    const data = JSON.parse(fs.readFileSync(asksFile(), "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAsks(list) {
  const file = asksFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, ASKS_KEEP), null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

/** Ask Claude a question across the saved transcripts and summaries. Cancellable like the other long jobs. */
ipcMain.handle("ask:question", (_e, question, scope) =>
  run(async () => {
    const text = String(question || "").trim();
    if (!text) throw new FriendlyError("Type a question first.");
    return withJob(null, "ask", async (signal) => {
      progress("Finding the passages that bear on the question…");
      const { keys } = keysAndDirs();
      let roster = null;
      try {
        roster = await loadCouncilRoster();
      } catch {
        roster = null;
      }
      const result = await askQuestion(
        { question: text, corpus: freshCorpus(), scope: scope && typeof scope === "object" ? scope : {}, roster },
        { apiKey: keys.anthropic, onProgress: (p) => progress(typeof p === "string" ? p : (p && p.text) || ""), signal }
      );
      currentJob = null;
      const entry = {
        id: `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        askedAt: new Date().toISOString(),
        question: text,
        scope: scope || {},
        answer: result.answer,
        citations: Array.isArray(result.citations) ? result.citations : [],
      };
      writeAsks([entry, ...readAsks()]);
      return {
        id: entry.id,
        askedAt: entry.askedAt,
        answer: entry.answer,
        citations: entry.citations,
        passagesCount: Array.isArray(result.passages) ? result.passages.length : 0,
        model: result.model || null,
      };
    });
  })
);

ipcMain.handle("ask:history", () => ({ ok: true, asks: readAsks() }));

ipcMain.handle("ask:remove", (_e, id) => {
  writeAsks(readAsks().filter((a) => a.id !== id));
  return { ok: true, asks: readAsks() };
});

/* ---- Bulk work: the job queue ------------------------------------------------------ */

function pushJobs() {
  if (mainWindow && !mainWindow.isDestroyed() && jobs) mainWindow.webContents.send("jobs", jobs.status());
}

/** Hold the app's busy flag while the queue has work, so single-meeting actions wait their turn. */
function onQueueChange() {
  const status = jobs.status();
  const active = Boolean(status.running) || status.pending.length > 0;
  if (active && !queueHoldsBusy && !busy) {
    queueHoldsBusy = true;
    busy = true;
  } else if (!active && queueHoldsBusy) {
    queueHoldsBusy = false;
    busy = false;
    progress("");
  }
  pushJobs();
}

/** One runner per job kind: the same code path as the single-meeting buttons. */
function queueRunners() {
  const both = (onProgress) => (text) => {
    progress(text);
    onProgress(text);
  };
  return {
    transcript: (meetingId, { signal, onProgress }) =>
      transcribeMeeting(meetingFor(meetingId), { signal, report: both(onProgress) }),
    summary: async (meetingId, { signal, onProgress }) => {
      const meeting = meetingFor(meetingId);
      const result = await summarizeMeeting(meeting, { draft: meeting.draft, signal, report: both(onProgress) });
      // Nobody is sitting at the editor during a bulk run, so the summary is saved into the draft.
      store.update(meetingId, { overview: result.suggestion.overview, details: result.suggestion.details });
      return result;
    },
    minutes: (meetingId, { signal, onProgress }) =>
      draftMeetingMinutes(meetingFor(meetingId), { currentMarkdown: "", signal, report: both(onProgress) }),
  };
}

ipcMain.handle("jobs:enqueue", (_e, items) => {
  if (busy && !queueHoldsBusy) return { ok: false, error: "Another action is still running. Wait for it to finish." };
  const list = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.meetingId === "string" && ["transcript", "summary", "minutes"].includes(it.kind))
    .map((it) => ({ meetingId: it.meetingId, kind: it.kind }));
  if (!list.length) return { ok: false, error: "Nothing to add: pick at least one meeting." };
  try {
    const result = jobs.enqueue(list);
    onQueueChange();
    return { ok: true, ...result, status: jobs.status() };
  } catch (e) {
    return failure(e);
  }
});

ipcMain.handle("jobs:status", () => ({ ok: true, status: jobs.status() }));

ipcMain.handle("jobs:cancelAll", () => {
  jobs.cancelAll();
  return { ok: true, status: jobs.status() };
});

ipcMain.handle("jobs:cancelOne", (_e, meetingId, kind) => {
  jobs.cancelOne(meetingId, kind);
  return { ok: true, status: jobs.status() };
});

/** Meetings to pick from for bulk work, with a Deepgram estimate.
 *  options: { kinds: ["council", …] | "all", monthsBack, needs: ["transcript" | "summary" | "minutes"] } */
ipcMain.handle("meetings:candidates", (_e, options) => {
  const o = options && typeof options === "object" ? options : {};
  const kinds = o.kinds === "all" ? null : new Set(Array.isArray(o.kinds) && o.kinds.length ? o.kinds : COUNCIL_KINDS);
  const monthsBack = Number(o.monthsBack) > 0 ? Number(o.monthsBack) : 12;
  const needs = Array.isArray(o.needs) && o.needs.length ? o.needs : ["transcript"];
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const sinceIso = since.toISOString().slice(0, 10);
  const candidates = [];
  for (const m of snapshot().meetings) {
    const src = m.source || {};
    if (!m.clipId || m.autoHidden) continue;
    if (kinds && !kinds.has(src.kind)) continue;
    if (!m.draft.date || m.draft.date < sinceIso) continue;
    const has = {
      transcript: Boolean(m.transcript),
      summary: Boolean(String(m.draft.overview || "").trim()),
      minutes: Boolean(m.minutes),
    };
    const missing = needs.filter((n) => !has[n]);
    if (!missing.length) continue;
    const minutes = src.durationSec ? Math.round(src.durationSec / 60) : null;
    const estMinutes = minutes || UNKNOWN_DURATION_MIN;
    candidates.push({
      id: m.id,
      clipId: m.clipId,
      date: m.draft.date,
      title: src.title || m.draft.title,
      body: src.body || null,
      kind: src.kind || null,
      durationSec: src.durationSec || null,
      durationLabel: src.durationLabel || "",
      durationKnown: Boolean(minutes),
      estimatedMinutes: estMinutes,
      estimatedCost: has.transcript ? 0 : Number((estMinutes * DEEPGRAM_PER_MINUTE).toFixed(2)),
      has,
      missing,
    });
  }
  return { ok: true, candidates, rate: DEEPGRAM_PER_MINUTE, assumedMinutes: UNKNOWN_DURATION_MIN };
});

// Dev helper: OV_USER_DATA=<folder> keeps test runs away from the real review state and keys.
if (process.env.OV_USER_DATA) app.setPath("userData", process.env.OV_USER_DATA);

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  store = new ReviewStore(userData);
  corpus = new Corpus({ transcriptsDir: transcriptsDir(), minutesDir: minutesDir() });
  topics = new TopicStore(userData);
  jobs = new JobQueue({ runners: queueRunners() });
  jobs.onChange(onQueueChange);
  cleanupTemp(tempDir());
  createWindow();
});

app.on("before-quit", () => {
  // Stop a running download so ffmpeg does not keep going after the window closes.
  if (currentJob) currentJob.controller.abort();
  if (jobs) jobs.cancelAll();
});

app.on("window-all-closed", () => app.quit());

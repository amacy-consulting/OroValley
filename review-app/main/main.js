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

let mainWindow = null;
let store = null;
let busy = false;
let currentJob = null; // { controller, id, kind } while a summary, transcript or minutes job runs
let listingCache = null; // { at, meetings }
const clipCache = new Map(); // meeting id -> resolved Swagit clip, for the session
const publishedMinutesCache = new Map(); // minutesSeq -> text
const LISTING_TTL_MS = 10 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Bundled files (keyterms.txt, sample minutes): next to app.asar when packaged, review-app/resources in development. */
function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

/** Transcripts and draft minutes go to Documents\Oro Valley Minutes, so a
 *  meeting is transcribed (and paid for) once and the Clerk's files are easy to find. */
function outputDir() {
  return path.join(app.getPath("documents"), "Oro Valley Minutes");
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
    backgroundColor: "#f6f1e7",
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
    const result = await store.refresh({
      sources: listing,
      settings: loadSettings(),
      onProgress: progress,
    });
    clipCache.clear();
    return { ...result, state: snapshot() };
  })
);

/** Quick edits to the review state. Refused while a publish is uploading, so
 *  nothing changes between what was sent and what is marked as published. */
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
ipcMain.handle("meeting:status", (_e, id, status) => edit(() => store.setStatus(id, status)));
ipcMain.handle("meeting:resolve", (_e, id, choice) => edit(() => store.resolveConflict(id, choice)));

/** Write (or rewrite) one meeting's summary: Swagit video -> transcript -> Claude. */
ipcMain.handle("meeting:summarize", (_e, id, draft, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to summarize.");
    return withJob(id, "summary", async (signal) => {
      progress("Looking up the video on Swagit…");
      const fields = draft && typeof draft === "object" ? draft : meeting.draft;
      const clip = withDraft(await clipFor(meeting, { signal }), fields);
      const result = await summarizeClip({
        clip,
        draft: fields,
        retranscribe: Boolean(options && options.retranscribe),
        ...keysAndDirs(),
        onProgress: (p) => progress(p.text),
        signal,
      });
      currentJob = null;
      return {
        suggestion: { overview: result.overview, details: result.details },
        transcriptReused: result.transcriptReused,
        agendaUsed: result.agendaUsed,
        state: snapshot(),
      };
    });
  })
);

/** Transcribe a meeting without writing anything else: Swagit video -> Deepgram -> saved file. */
ipcMain.handle("transcript:create", (_e, id, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to transcribe.");
    return withJob(id, "transcript", async (signal) => {
      progress("Looking up the video on Swagit…");
      const clip = withDraft(await clipFor(meeting, { signal }), meeting.draft);
      const result = await obtainTranscript({
        clip,
        retranscribe: Boolean(options && options.retranscribe),
        ...keysAndDirs(),
        report: (text) => progress(text),
        signal,
      });
      currentJob = null;
      return {
        transcriptReused: Boolean(result.reused),
        transcriptSource: result.source || null,
        name: result.txtPath ? path.basename(result.txtPath) : null,
        state: snapshot(),
      };
    });
  })
);

/** Draft (or redraft) the minutes: transcript + agenda + the sample minutes -> Claude -> saved markdown. */
ipcMain.handle("minutes:draft", (_e, id, currentMarkdown, options) =>
  run(async () => {
    const meeting = meetingFor(id);
    if (!meeting.clipId) throw new FriendlyError("This meeting has no Swagit video to draft minutes from.");
    return withJob(id, "minutes", async (signal) => {
      progress("Looking up the video on Swagit…");
      const clip = withDraft(await clipFor(meeting, { signal }), meeting.draft);
      // `draft` is the Clerk's current Markdown (a redraft keeps their edits), or null for a first draft.
      const current = typeof currentMarkdown === "string" ? currentMarkdown.trim() : "";
      const result = await draftMinutes({
        clip,
        draft: current || null,
        retranscribe: Boolean(options && options.retranscribe),
        ...keysAndDirs(),
        onProgress: (p) => progress(typeof p === "string" ? p : p && p.text),
        signal,
      });
      currentJob = null;
      return {
        minutes: result.minutes,
        notes: Array.isArray(result.notes) ? result.notes : [],
        transcriptReused: Boolean(result.transcriptReused),
        agendaUsed: Boolean(result.agendaUsed),
        sampleUsed: Boolean(result.sampleUsed),
        savedPath: result.savedPath || null,
        state: snapshot(),
      };
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
      // Per-timestamp links are playBase + "/" + seconds.
      playBase: clipId ? sources.playerUrl(clipId, 1).replace(/\/1$/, "") : null,
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
      playBase: sources.playerUrl(clip.clipId, 1).replace(/\/1$/, ""),
    };
  } catch (e) {
    return failure(e);
  }
});

ipcMain.handle("clipboard:write", (_e, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

ipcMain.handle("publish", () =>
  run(async () => {
    progress("Publishing to the website…");
    const result = await store.publish(loadSettings());
    return { result, state: snapshot() };
  })
);

ipcMain.handle("settings:save", (_e, update) =>
  edit(() => {
    const before = loadSettings();
    const after = saveSettings(update);
    // A different repository or branch is a different website file.
    if (after.githubRepo !== before.githubRepo || after.githubBranch !== before.githubBranch) store.forgetPublished();
  })
);

ipcMain.handle("open:external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
});

// Dev helper: OV_USER_DATA=<folder> keeps test runs away from the real review state and keys.
if (process.env.OV_USER_DATA) app.setPath("userData", process.env.OV_USER_DATA);

app.whenReady().then(() => {
  store = new ReviewStore(app.getPath("userData"));
  cleanupTemp(tempDir());
  createWindow();
});

app.on("before-quit", () => {
  // Stop a running download so ffmpeg does not keep going after the window closes.
  if (currentJob) currentJob.controller.abort();
});

app.on("window-all-closed", () => app.quit());

/** Swagit recording -> transcript -> the AI model minutes draft -> saved .md
 *
 *  Shared by the app (main.js) and the tests. No Electron imports; folders
 *  come in through `dirs`: { output, temp, reference }, like pipeline.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const pipeline = require("./pipeline");
const { loadCouncilRoster } = require("./roster");
const { writeMinutes } = require("./minutes");
const minutesStore = require("./minutesStore");
const { CancelledError, SummaryError, throwIfCancelled } = require("./errors");

const SAMPLE_FILE = "minutes-sample-2025-11-19.txt";

/** The bundled sample of the Town's published minutes, or "" if it can't be read. */
function readBundledSample(referenceDir) {
  const candidates = [
    referenceDir ? path.join(referenceDir, SAMPLE_FILE) : null,
    path.join(__dirname, "..", "..", "resources", SAMPLE_FILE),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch {
      /* try the next one */
    }
  }
  return "";
}

/** The posted agenda as a detail object, or null. Falls back to the text-only agenda. */
async function obtainAgenda({ clip, report, signal }) {
  if (typeof pipeline.obtainAgendaDetail === "function") {
    return pipeline.obtainAgendaDetail({ clip, report, signal });
  }
  if (typeof pipeline.obtainAgenda === "function") {
    const agendaText = await pipeline.obtainAgenda({ clip, report, signal });
    return agendaText ? { agendaText, items: [] } : null;
  }
  return null;
}

/**
 * A style sample: the Town's published minutes for this very meeting when
 * there are some (so a regenerated draft can be compared with the record),
 * otherwise the bundled sample. Resolves { text, used } with used one of
 * "published" | "bundled" | "none".
 */
async function obtainSample({ clip, dirs, report, signal }) {
  if (clip.minutesSeq) {
    report("Reading the Town's published minutes for this meeting…");
    try {
      const sources = require("./sources");
      const { text } = await sources.fetchPublishedMinutes(clip.minutesSeq, { signal });
      if (text && text.trim().length > 500) return { text: text.trim(), used: "published" };
    } catch (e) {
      if (e instanceof CancelledError || (signal && signal.aborted)) throw new CancelledError();
      report(`Could not read the published minutes (${e.message}); using the bundled sample instead.`);
    }
  }
  const text = readBundledSample(dirs && dirs.reference);
  return text ? { text, used: "bundled" } : { text: "", used: "none" };
}

/**
 * The whole job for one clip (from sources.resolveClip). `draft` is the
 * Clerk's current Markdown, if any. Resolves
 * { minutes, notes, transcriptPath, transcriptReused, agendaUsed, sampleUsed, savedPath }.
 */
async function draftMinutes({ clip, draft = null, retranscribe = false, keys = {}, dirs, onProgress, signal }) {
  const report = (text, extra = {}) => onProgress && onProgress({ text, ...extra });

  // Check the Anthropic key first so no transcription money is spent on a job that cannot finish.
  if (!keys.anthropic) {
    throw new SummaryError("Add the Town's Anthropic API key in Settings to draft minutes.", { needsKey: true, keyKind: "anthropic" });
  }

  const transcript = await pipeline.obtainTranscript({ clip, retranscribe, keys, dirs, report, signal });
  throwIfCancelled(signal);

  const agenda = await obtainAgenda({ clip, report, signal });
  throwIfCancelled(signal);

  report("Checking the current Town Council roster…");
  const roster = await loadCouncilRoster();
  throwIfCancelled(signal);

  const sample = await obtainSample({ clip, dirs, report, signal });
  throwIfCancelled(signal);

  const index = Array.isArray(clip.index) ? clip.index : [];
  report(
    draft
      ? "Revising the minutes draft. This can take several minutes for a long meeting…"
      : "Drafting the minutes. This can take several minutes for a long meeting…"
  );
  const result = await writeMinutes(
    { clip, agenda, transcript: transcript.body, index, roster, publishedSample: sample.text, draft: draft || "" },
    { apiKey: keys.anthropic, onProgress: (t) => report(t, { transient: true }), signal }
  );

  const dir = minutesStore.minutesDir(dirs.output);
  const { mdPath } = minutesStore.saveMinutes(dir, clip, result.minutes, { notes: result.notes });
  report(`Draft saved: ${path.basename(mdPath)}`);

  return {
    minutes: result.minutes,
    notes: result.notes,
    transcriptPath: transcript.txtPath,
    transcriptReused: transcript.reused,
    agendaUsed: Boolean(agenda && (agenda.agendaText || (agenda.items && agenda.items.length))),
    sampleUsed: sample.used,
    savedPath: mdPath,
  };
}

module.exports = { draftMinutes, obtainSample, readBundledSample, SAMPLE_FILE };

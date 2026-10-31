/** The searchable corpus: every meeting the review store knows about, with its
 *  transcript turns, staff summary and minutes draft loaded from disk.
 *
 *  refresh() is cheap enough to run before every search: it stats each file
 *  and re-reads only the ones whose mtime or size changed. The per-kind text
 *  indexes that search.js scans (one joined string per kind plus the start
 *  offset of every turn or paragraph) are built once per file version and
 *  cached with it.
 */
"use strict";

const fs = require("fs");
const transcripts = require("./transcripts");
const minutesStore = require("./minutesStore");
const { playerUrl } = require("./sources");

const TURN = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\s*(?:(Speaker\s+[\d?]+):\s*)?(.*)$/;
const NOTE = /^---.*---$/;
const MARKDOWN_PREFIX = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/;

/**
 * Transcript body -> [{ i, sec, time, speaker, text }].
 * Handles "[HH:MM:SS] Speaker N: text" turns separated by blank lines, the
 * captions variant without a speaker, continuation lines, and skips the
 * "--- Part 2 of 2 (...) ---" notes. Text without any timestamp (the flat
 * transcript fallback) becomes a turn with sec, time and speaker null.
 */
function parseTurns(body) {
  const turns = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const text = cur.text.replace(/\s+/g, " ").trim();
      if (text) turns.push({ i: turns.length, sec: cur.sec, time: cur.time, speaker: cur.speaker, text });
    }
    cur = null;
  };
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || NOTE.test(line)) {
      flush();
      continue;
    }
    const m = line.match(TURN);
    if (m) {
      flush();
      cur = {
        sec: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
        time: `${m[1].padStart(2, "0")}:${m[2]}:${m[3]}`,
        speaker: m[4] ? m[4].replace(/\s+/g, " ") : null,
        text: m[5] || "",
      };
      continue;
    }
    if (cur) cur.text += " " + line;
    else cur = { sec: null, time: null, speaker: null, text: line };
  }
  flush();
  return turns;
}

/** Markdown (summary details, minutes draft) -> paragraph units, one per non-empty line. */
function parseParagraphs(text) {
  const units = [];
  for (const rawLine of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim().replace(MARKDOWN_PREFIX, "").replace(/\s+/g, " ").trim();
    if (line) units.push({ i: units.length, text: line });
  }
  return units;
}

/** One joined string per kind plus each unit's start offset, so a regex scan maps back to its unit. */
function buildSection(units) {
  const starts = new Array(units.length);
  const parts = new Array(units.length);
  let offset = 0;
  for (let i = 0; i < units.length; i++) {
    starts[i] = offset;
    parts[i] = units[i].text;
    offset += units[i].text.length + 1;
  }
  return { text: parts.join("\n"), starts, units };
}

function summaryTextOf(draft) {
  return [draft.overview, draft.details]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

class Corpus {
  constructor({ transcriptsDir, minutesDir }) {
    this.transcriptsDir = transcriptsDir;
    this.minutesDir = minutesDir;
    this._files = new Map(); // path -> { mtimeMs, size, value, section, seen }
    this._summaries = new Map(); // meetingId -> { text, section, seen }
    this._docs = [];
    this._byId = new Map();
    this._index = new Map(); // meetingId -> { transcript, summary, minutes } sections
    this._counts = { meetings: 0, transcripts: 0, minutesDrafts: 0, summaries: 0, turns: 0 };
  }

  /** Parse a file once per version (mtime + size); returns null when it cannot be read. */
  _cached(filePath, parse) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      this._files.delete(filePath);
      return null;
    }
    const hit = this._files.get(filePath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      hit.seen = true;
      return hit;
    }
    let entry;
    try {
      entry = parse(filePath);
    } catch (e) {
      console.error(`Could not read ${filePath}: ${e.message}`);
      this._files.delete(filePath);
      return null;
    }
    entry.mtimeMs = stat.mtimeMs;
    entry.size = stat.size;
    entry.seen = true;
    this._files.set(filePath, entry);
    return entry;
  }

  _summary(meetingId, text) {
    const hit = this._summaries.get(meetingId);
    if (hit && hit.text === text) {
      hit.seen = true;
      return hit;
    }
    const entry = { text, section: buildSection(parseParagraphs(text)), seen: true };
    this._summaries.set(meetingId, entry);
    return entry;
  }

  /** Rebuild the documents for these meetings (store.view().meetings). Returns the counts. */
  refresh(meetings) {
    const tIndex = transcripts.indexTranscripts(this.transcriptsDir);
    const mIndex = minutesStore.indexMinutes(this.minutesDir);
    for (const e of this._files.values()) e.seen = false;
    for (const e of this._summaries.values()) e.seen = false;

    const docs = [];
    const byId = new Map();
    const index = new Map();
    const counts = { meetings: 0, transcripts: 0, minutesDrafts: 0, summaries: 0, turns: 0 };

    for (const m of Array.isArray(meetings) ? meetings : []) {
      if (!m || !m.id || byId.has(m.id)) continue;
      const draft = m.draft || {};
      const source = m.source || {};
      const clipId = m.clipId != null && Number.isFinite(Number(m.clipId)) ? Number(m.clipId) : null;

      const tPath = clipId != null ? tIndex.get(clipId) || null : null;
      const tEntry = tPath
        ? this._cached(tPath, (p) => {
            const turns = parseTurns(transcripts.readTranscriptBody(p));
            return { value: turns, section: buildSection(turns) };
          })
        : null;
      const mPath = clipId != null ? mIndex.get(clipId) || null : null;
      const mEntry = mPath
        ? this._cached(mPath, (p) => {
            const text = minutesStore.readMinutes(p).markdown;
            return { value: text, section: buildSection(parseParagraphs(text)) };
          })
        : null;
      const summaryText = summaryTextOf(draft);
      const sEntry = summaryText ? this._summary(m.id, summaryText) : null;

      const durationSec =
        source.durationSec != null
          ? Number(source.durationSec)
          : draft.durationMinutes
            ? Number(draft.durationMinutes) * 60
            : null;
      const doc = {
        meetingId: m.id,
        clipId,
        date: draft.date || source.date || null,
        title: draft.title || source.title || "",
        body: source.body || "",
        kind: source.kind || "",
        playerUrl: source.playerUrl || (clipId != null ? playerUrl(clipId) : null),
        durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
        status: m.status || null,
        hasTranscript: Boolean(tEntry && tEntry.value.length),
        hasSummary: Boolean(sEntry),
        hasMinutes: Boolean(mEntry && mEntry.value),
        transcript: tEntry ? { path: tPath, turns: tEntry.value } : null,
        summary: sEntry ? { text: sEntry.text } : null,
        minutes: mEntry ? { path: mPath, text: mEntry.value } : null,
      };
      docs.push(doc);
      byId.set(doc.meetingId, doc);
      index.set(doc.meetingId, {
        transcript: tEntry ? tEntry.section : null,
        summary: sEntry ? sEntry.section : null,
        minutes: mEntry ? mEntry.section : null,
      });
      counts.meetings += 1;
      if (doc.hasTranscript) {
        counts.transcripts += 1;
        counts.turns += doc.transcript.turns.length;
      }
      if (doc.hasMinutes) counts.minutesDrafts += 1;
      if (doc.hasSummary) counts.summaries += 1;
    }

    for (const [p, e] of this._files) if (!e.seen) this._files.delete(p);
    for (const [id, e] of this._summaries) if (!e.seen) this._summaries.delete(id);
    docs.sort(
      (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title).localeCompare(String(b.title))
    );
    this._docs = docs;
    this._byId = byId;
    this._index = index;
    this._counts = counts;
    return { ...counts };
  }

  /** Meeting documents, newest first. */
  get docs() {
    return this._docs;
  }

  get(meetingId) {
    return this._byId.get(meetingId) || null;
  }

  /** The scan index for one meeting and kind ("transcript" | "summary" | "minutes"), or null. */
  section(meetingId, kind) {
    const entry = this._index.get(meetingId);
    return entry ? entry[kind] || null : null;
  }

  /** The refresh counts plus the date range of transcribed meetings and their total hours. */
  stats() {
    let earliest = null;
    let latest = null;
    let seconds = 0;
    for (const doc of this._docs) {
      if (!doc.hasTranscript) continue;
      if (doc.date) {
        if (!earliest || doc.date < earliest) earliest = doc.date;
        if (!latest || doc.date > latest) latest = doc.date;
      }
      const turns = doc.transcript.turns;
      const last = turns[turns.length - 1];
      seconds += doc.durationSec || (last && last.sec != null ? last.sec + 60 : 0);
    }
    return { ...this._counts, earliest, latest, transcriptHours: Math.round((seconds / 3600) * 10) / 10 };
  }
}

module.exports = { Corpus, parseTurns, parseParagraphs, buildSection };

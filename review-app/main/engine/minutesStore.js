/** Saved minutes drafts: Documents\Oro Valley Minutes\Minutes\<Date> <Meeting> Minutes DRAFT (video N).md
 *
 *  Each draft is one Markdown file the Clerk can open in any editor. Reviewer
 *  notes and the save time ride along in an HTML comment at the top of the
 *  file, which readMinutes strips off. The video number in the file name is
 *  how a later run finds the draft, so the date part can be renamed freely.
 *  The version a save replaces is kept in Minutes\Previous.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { dateLabel, meetingLabel } = require("./transcripts");

const META_OPEN = "<!-- oro-valley-minutes-draft";
const META_CLOSE = "-->";

function minutesDir(outputDir) {
  const dir = path.join(outputDir, "Minutes");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function minutesStem(clip) {
  return `${dateLabel(clip.date)} ${meetingLabel(clip.title)} Minutes DRAFT (video ${clip.clipId})`;
}

/** Newest saved draft (.md) for this video, or null. */
function findMinutes(dir, clipId) {
  if (!fs.existsSync(dir)) return null;
  const suffix = `(video ${clipId}).md`;
  const hits = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(suffix))
    .map((n) => path.join(dir, n))
    .filter((p) => fs.statSync(p).isFile())
    .map((p) => ({ p, t: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return hits.length ? hits[0].p : null;
}

/** Map of clipId -> draft path for every saved draft. */
function indexMinutes(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/\(video (\d+)\)\.md$/);
    if (m && !map.has(Number(m[1]))) map.set(Number(m[1]), path.join(dir, name));
  }
  return map;
}

function stampForName(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Copy the draft being replaced into Minutes\Previous so an edit is never lost. */
function keepPrevious(dir, oldPath) {
  try {
    const prevDir = path.join(dir, "Previous");
    fs.mkdirSync(prevDir, { recursive: true });
    const stamp = stampForName(new Date(fs.statSync(oldPath).mtimeMs));
    const base = path.basename(oldPath, ".md");
    fs.copyFileSync(oldPath, path.join(prevDir, `${base} ${stamp}.md`));
  } catch {
    /* best effort */
  }
}

/**
 * Write the draft. Replaces any earlier draft of the same video (keeping a
 * copy in Previous). Returns { mdPath }.
 */
function saveMinutes(dir, clip, markdown, { notes = [] } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const old = findMinutes(dir, clip.clipId);
  const mdPath = path.join(dir, `${minutesStem(clip)}.md`);
  const savedAt = new Date().toISOString();
  const meta = {
    savedAt,
    clipId: clip.clipId,
    title: clip.title || "",
    date: clip.date || "",
    notes: (Array.isArray(notes) ? notes : []).map((n) => String(n)),
  };
  // JSON never contains "-->" once "--" is escaped, so the comment can't close early.
  const json = JSON.stringify(meta, null, 1).replace(/--/g, "-\\u002d");
  const body = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  const text = `${META_OPEN}\n${json}\n${META_CLOSE}\n\n${body}\n`;

  if (old) keepPrevious(dir, old);
  fs.writeFileSync(mdPath, text, "utf-8");
  if (old && path.resolve(old) !== path.resolve(mdPath)) {
    try {
      fs.unlinkSync(old);
    } catch {
      /* open in another program; leave it */
    }
  }
  return { mdPath };
}

/** Split a saved file into its metadata comment and the Markdown. */
function parseSaved(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  if (!src.startsWith(META_OPEN)) return { meta: {}, markdown: src.trim() };
  const end = src.indexOf(META_CLOSE);
  if (end === -1) return { meta: {}, markdown: src.trim() };
  let meta = {};
  try {
    meta = JSON.parse(src.slice(META_OPEN.length, end));
  } catch {
    meta = {};
  }
  return { meta, markdown: src.slice(end + META_CLOSE.length).trim() };
}

/** Returns { markdown, notes, savedAt } for a saved draft. savedAt is ISO text or null. */
function readMinutes(mdPath) {
  const { meta, markdown } = parseSaved(fs.readFileSync(mdPath, "utf-8"));
  let savedAt = meta.savedAt || null;
  if (!savedAt) {
    try {
      savedAt = new Date(fs.statSync(mdPath).mtimeMs).toISOString();
    } catch {
      savedAt = null;
    }
  }
  return {
    markdown,
    notes: Array.isArray(meta.notes) ? meta.notes.map((n) => String(n)) : [],
    savedAt,
  };
}

module.exports = { minutesDir, minutesStem, findMinutes, indexMinutes, saveMinutes, readMinutes, parseSaved };

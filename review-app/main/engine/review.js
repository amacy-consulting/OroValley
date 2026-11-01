/** The review workflow: pull recordings from Swagit and Destiny and keep each
 *  one's status, summary draft and edits on this computer. Nothing here leaves
 *  the staff PC; the summary is an analysis artifact used by Search and Ask Claude.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { toDraft, sourceOf, reviewFlags, clipKey, recordClipId, normalizeRecord } = require("./meetings");

const STATUSES = new Set(["active", "hidden"]);
const EDITABLE_FIELDS = ["date", "title", "overview", "details", "durationMinutes"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize saved records: key every entry by its Swagit video id and fold the
 *  old "review" / "approved" statuses (from the publishing days) into "active". */
function migrate(saved) {
  const meetings = {};
  for (const entry of Object.values((saved && saved.meetings) || {})) {
    if (!entry || !entry.draft) continue;
    const draft = normalizeRecord(entry.draft);
    if (meetings[draft.id]) continue; // two old records for one clip: keep the first
    meetings[draft.id] = {
      status: entry.status === "hidden" ? "hidden" : "active",
      autoHidden: Boolean(entry.autoHidden),
      flags: Array.isArray(entry.flags) ? entry.flags : [],
      draft,
      source: entry.source || {},
    };
  }
  return { meetings };
}

class ReviewStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, "review-state.json");
    this.state = this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return { meetings: {} };
    try {
      return migrate(JSON.parse(fs.readFileSync(this.file, "utf-8")));
    } catch (e) {
      // Keep the damaged file for IT rather than silently losing edits.
      fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      console.error("review-state.json was unreadable and has been set aside:", e.message);
      return { meetings: {} };
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
    fs.renameSync(tmp, this.file);
  }

  _entry(id) {
    const entry = this.state.meetings[id];
    if (!entry) throw new Error(`Unknown meeting ${id}`);
    return entry;
  }

  /** Pull the recordings listing and add any new ones. Returns { added }. */
  async refresh({ sources, onProgress = () => {} }) {
    onProgress("Checking Swagit and Destiny for new recordings…");
    // Every recording in the archive, so older meetings can be analyzed too.
    const listing = await sources.listMeetings();
    let added = 0;
    for (const clip of listing) {
      const id = clipKey(clip.clipId);
      const flags = reviewFlags(clip, listing);
      const entry = this.state.meetings[id];
      if (entry) {
        // Keep the reviewer's work; refresh what the Town's sources say about the
        // recording (for example, official minutes posted later).
        entry.source = sourceOf(clip);
        entry.flags = flags;
        continue;
      }
      added += 1;
      const { source, ...draft } = toDraft(clip);
      const autoHidden = flags.some((f) => f.code === "low-content");
      this.state.meetings[id] = {
        status: autoHidden ? "hidden" : "active",
        autoHidden,
        flags,
        draft,
        source,
      };
    }
    this._save();
    return { added };
  }

  /** Save edits to a meeting's draft: date, title, overview, details, durationMinutes. */
  update(id, fields) {
    const entry = this._entry(id);
    const next = { ...entry.draft };
    for (const key of EDITABLE_FIELDS) {
      if (fields[key] !== undefined) next[key] = fields[key];
    }
    next.date = next.date ? String(next.date).trim() : null;
    if (next.date && !DATE.test(next.date)) throw new Error("The meeting date must be a date like 2026-10-12.");
    if (next.durationMinutes !== undefined && next.durationMinutes !== null) {
      const n = Number(next.durationMinutes);
      next.durationMinutes = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    entry.draft = next;
    this._save();
  }

  /** "active" shows the meeting in the list; "hidden" tucks it away (tests, duplicates). */
  setStatus(id, status) {
    if (!STATUSES.has(status)) throw new Error(`Unknown status ${status}`);
    const entry = this._entry(id);
    entry.status = status;
    entry.autoHidden = false;
    this._save();
  }

  /** { meetings: [{ id, clipId, status, autoHidden, flags, draft, source }] }, newest first. */
  view() {
    const meetings = Object.values(this.state.meetings)
      .map((entry) => ({
        id: entry.draft.id,
        clipId: (entry.source && entry.source.clipId) || recordClipId(entry.draft),
        status: entry.status,
        autoHidden: Boolean(entry.autoHidden),
        flags: entry.flags || [],
        draft: entry.draft,
        source: entry.source || {},
      }))
      .sort((a, b) => String(b.draft.date || "").localeCompare(String(a.draft.date || "")));
    return { meetings };
  }
}

module.exports = { ReviewStore };

/** Watched keywords ("topics"): a named list of search terms the Clerk's
 *  office wants to follow across meetings, with per-meeting hit counts and a
 *  month-by-month trend. Stored in <userData>\topics.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ALL_KINDS, parseQuery, compile, scanSection, inScope } = require("./search");

const PALETTE = ["#236298", "#002d74", "#9a6a00", "#0e8421", "#5b6a70", "#6b3fa0", "#b5542a", "#0d7c86"];

function normalizeTerms(terms) {
  const list = Array.isArray(terms) ? terms : String(terms || "").split(/[,\n]/);
  const out = [];
  for (const raw of list) {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function newId() {
  return `t_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

class TopicStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, "topics.json");
    this.topics = this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      const list = Array.isArray(data) ? data : Array.isArray(data.topics) ? data.topics : [];
      return list
        .filter((t) => t && t.id && t.name)
        .map((t) => ({
          id: String(t.id),
          name: String(t.name),
          terms: normalizeTerms(t.terms),
          color: t.color || PALETTE[0],
          createdAt: t.createdAt || new Date().toISOString(),
        }));
    } catch (e) {
      fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      console.error("topics.json was unreadable and has been set aside:", e.message);
      return [];
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.topics, null, 2), "utf-8");
    fs.renameSync(tmp, this.file);
  }

  _nextColor() {
    const used = this.topics.map((t) => t.color);
    for (const c of PALETTE) if (!used.includes(c)) return c;
    return PALETTE[this.topics.length % PALETTE.length];
  }

  list() {
    return this.topics.map((t) => ({ ...t, terms: t.terms.slice() }));
  }

  get(id) {
    const t = this.topics.find((x) => x.id === id);
    return t ? { ...t, terms: t.terms.slice() } : null;
  }

  add({ name, terms, color } = {}) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Give the topic a name.");
    const cleanTerms = normalizeTerms(terms);
    if (!cleanTerms.length) throw new Error("Add at least one term to watch.");
    const topic = {
      id: newId(),
      name: cleanName,
      terms: cleanTerms,
      color: color || this._nextColor(),
      createdAt: new Date().toISOString(),
    };
    this.topics.push(topic);
    this._save();
    return { ...topic, terms: topic.terms.slice() };
  }

  update(id, { name, terms, color } = {}) {
    const topic = this.topics.find((t) => t.id === id);
    if (!topic) throw new Error(`Unknown topic ${id}`);
    if (name !== undefined) {
      const cleanName = String(name || "").trim();
      if (!cleanName) throw new Error("Give the topic a name.");
      topic.name = cleanName;
    }
    if (terms !== undefined) {
      const cleanTerms = normalizeTerms(terms);
      if (!cleanTerms.length) throw new Error("Add at least one term to watch.");
      topic.terms = cleanTerms;
    }
    if (color !== undefined && color) topic.color = String(color);
    this._save();
    return { ...topic, terms: topic.terms.slice() };
  }

  remove(id) {
    const before = this.topics.length;
    this.topics = this.topics.filter((t) => t.id !== id);
    if (this.topics.length === before) throw new Error(`Unknown topic ${id}`);
    this._save();
  }
}

// ---------- matching ----------

// section object -> Map(termKey -> sorted unit indexes). Sections are rebuilt
// only when their file changes, so the WeakMap invalidates itself.
const hitCache = new WeakMap();

/** Unit indexes in a section that match one topic term (all of its words, none of its exclusions). */
function termHits(section, term) {
  let perTerm = hitCache.get(section);
  if (!perTerm) {
    perTerm = new Map();
    hitCache.set(section, perTerm);
  }
  const key = term.toLowerCase();
  const hit = perTerm.get(key);
  if (hit) return hit;
  const patterns = compile(parseQuery(term));
  let units = [];
  if (patterns.must.length) {
    for (const [idx, u] of scanSection(section, patterns)) {
      if (u.terms.size === patterns.must.length && !u.excluded) units.push(idx);
    }
    units.sort((a, b) => a - b);
  }
  perTerm.set(key, units);
  return units;
}

/** Hits for one topic in one meeting: { hits, firstSec, firstTime } (any term, any kind). */
function meetingHits(corpus, doc, topic) {
  let hits = 0;
  let firstSec = null;
  let firstTime = null;
  for (const kind of ALL_KINDS) {
    const section = corpus.section(doc.meetingId, kind);
    if (!section || !section.units.length) continue;
    const matched = new Set();
    for (const term of topic.terms || []) for (const idx of termHits(section, term)) matched.add(idx);
    hits += matched.size;
    if (kind === "transcript" && matched.size) {
      for (const idx of matched) {
        const u = section.units[idx];
        if (u.sec != null && (firstSec == null || u.sec < firstSec)) {
          firstSec = u.sec;
          firstTime = u.time;
        }
      }
    }
  }
  return { hits, firstSec, firstTime };
}

function monthOf(date) {
  const m = String(date || "").match(/^(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every month from first to last inclusive, chronological. */
function monthRange(first, last) {
  const out = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthBuckets(months, perMeeting) {
  const map = new Map(months.map((m) => [m, { month: m, hits: 0, meetings: 0 }]));
  for (const m of perMeeting) {
    const b = map.get(monthOf(m.date));
    if (!b) continue;
    b.hits += m.hits;
    b.meetings += 1;
  }
  return [...map.values()];
}

/** Where and how often one topic comes up: per meeting (date desc) and per month (chronological, zero months included). */
function topicStats(corpus, topic, { from = null, to = null, bodies = null } = {}) {
  const scope = {
    from: from || null,
    to: to || null,
    bodySet: Array.isArray(bodies) && bodies.length ? new Set(bodies) : null,
    idSet: null,
  };
  const meetings = [];
  for (const doc of corpus.docs) {
    if (!inScope(doc, scope)) continue;
    const { hits, firstSec, firstTime } = meetingHits(corpus, doc, topic);
    if (!hits) continue;
    meetings.push({
      meetingId: doc.meetingId,
      clipId: doc.clipId,
      date: doc.date,
      title: doc.title,
      body: doc.body,
      hits,
      firstSec,
      firstTime,
    });
  }
  meetings.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const dated = meetings.map((m) => monthOf(m.date)).filter(Boolean).sort();
  const byMonth = dated.length ? monthBuckets(monthRange(dated[0], dated[dated.length - 1]), meetings) : [];
  return {
    topicId: topic.id,
    name: topic.name,
    totalHits: meetings.reduce((n, m) => n + m.hits, 0),
    meetingsCount: meetings.length,
    meetings,
    byMonth,
  };
}

/** The topics that come up in one meeting: [{ topicId, name, color, hits }], hits desc, only hits > 0. */
function topicsForMeeting(corpus, topics, meetingId) {
  const doc = corpus.get(meetingId);
  if (!doc) return [];
  return (topics || [])
    .map((t) => ({ topicId: t.id, name: t.name, color: t.color, hits: meetingHits(corpus, doc, t).hits }))
    .filter((t) => t.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
}

/** Every topic with its totals and a 12-month trend ending this month. */
function topicsOverview(corpus, topics, { now = new Date() } = {}) {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const months = monthRange(addMonths(current, -11), current);
  return (topics || []).map((topic) => {
    const stats = topicStats(corpus, topic);
    const trend = monthBuckets(months, stats.meetings).map(({ month, hits }) => ({ month, hits }));
    return {
      topicId: topic.id,
      name: topic.name,
      color: topic.color,
      totalHits: stats.totalHits,
      meetingsCount: stats.meetingsCount,
      lastDate: stats.meetings.length ? stats.meetings[0].date : null,
      trend,
    };
  });
}

module.exports = { TopicStore, PALETTE, topicStats, topicsForMeeting, topicsOverview, normalizeTerms, monthRange, addMonths };

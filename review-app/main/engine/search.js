/** Keyword search across transcripts, summaries and minutes drafts.
 *
 *  Query syntax: space-separated terms are ANDed at the meeting level, "quoted
 *  text" is a phrase, -word excludes, a trailing * is a prefix wildcard, and a
 *  term also matches its simple plural and possessive (park, parks, park's).
 *  Matching is case-insensitive.
 *
 *  Each kind of text is scanned as one joined string per meeting (see
 *  corpus.js), and every match is mapped back to its turn or paragraph by a
 *  binary search over the unit start offsets. That keeps a query over a
 *  hundred long transcripts well under a second.
 */
"use strict";

const ALL_KINDS = ["transcript", "summary", "minutes"];
const SUFFIX = "(?:s|es|'s|’s)?";
const SNIPPET_CHARS = 320;
const WORD_SEP = "[^\\S\\n]+"; // whitespace that never crosses a unit boundary
const MIN_TERM = 2;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex source for one term (with wildcard and plural handling) or phrase. */
function patternFor(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const parts = words.map((w, i) => {
    const last = i === words.length - 1;
    if (last && w.endsWith("*")) {
      const stem = w.slice(0, -1);
      return stem ? `${escapeRe(stem)}\\w*(?:'s|’s)?` : null;
    }
    return escapeRe(w) + (last ? SUFFIX : "");
  });
  if (parts.some((p) => p === null)) return null;
  return `(?<!\\w)${parts.join(WORD_SEP)}(?!\\w)`;
}

/** "budget \"la canada\" -golf park*" -> { terms, phrases, excluded, raw }. */
function parseQuery(text) {
  const raw = String(text || "");
  const terms = [];
  const phrases = [];
  const excluded = [];
  const re = /(-?)(?:"([^"]*)"|“([^”]*)”|(\S+))/g;
  let m;
  while ((m = re.exec(raw))) {
    const negated = m[1] === "-";
    const quoted = m[2] != null ? m[2] : m[3];
    if (quoted != null) {
      const phrase = quoted.trim().replace(/\s+/g, " ").toLowerCase();
      if (phrase.length < MIN_TERM) continue;
      if (negated) excluded.push(phrase);
      else if (phrase.includes(" ")) phrases.push(phrase);
      else terms.push(phrase);
      continue;
    }
    const tok = m[4]
      .toLowerCase()
      .replace(/["“”]/g, "")
      .replace(/^[^\w$]+/, "")
      .replace(/[^\w%*’']+$/, "");
    if (tok.replace(/\*/g, "").length < MIN_TERM) continue;
    (negated ? excluded : terms).push(tok);
  }
  return { terms, phrases, excluded, raw };
}

const compiled = new Map();

/** Compile a parsed query to { must: [regex], not: [regex] } (global, case-insensitive). Memoized. */
function compile(parsed) {
  const key = JSON.stringify([parsed.terms, parsed.phrases, parsed.excluded]);
  const hit = compiled.get(key);
  if (hit) return hit;
  const toRe = (list) =>
    list
      .map(patternFor)
      .filter(Boolean)
      .map((src) => new RegExp(src, "gi"));
  const out = { must: toRe([...parsed.terms, ...parsed.phrases]), not: toRe(parsed.excluded) };
  if (compiled.size > 200) compiled.clear();
  compiled.set(key, out);
  return out;
}

function test(re, text) {
  re.lastIndex = 0;
  return re.test(text);
}

/** Index of the unit that contains a character offset (largest start <= offset). */
function unitAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Sort ranges and merge overlapping ones. */
function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Character ranges [[start, end], ...] of every term and phrase match in text (for highlighting). */
function highlightRanges(text, parsedQuery) {
  const src = String(text || "");
  const { must } = compile(parsedQuery);
  const ranges = [];
  for (const re of must) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) if (m[0]) ranges.push([m.index, m.index + m[0].length]);
  }
  return mergeRanges(ranges);
}

/** Number of term and phrase matches in text. */
function countMatches(text, parsedQuery) {
  const src = String(text || "");
  const { must } = compile(parsedQuery);
  let n = 0;
  for (const re of must) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) if (m[0]) n += 1;
  }
  return n;
}

/**
 * Scan one section with the compiled patterns. Returns Map unitIndex ->
 * { ranges: [[s, e]], terms: Set of must-pattern indexes, excluded: boolean }.
 */
function scanSection(section, { must, not }) {
  const units = new Map();
  const entry = (idx) => {
    let u = units.get(idx);
    if (!u) {
      u = { ranges: [], terms: new Set(), excluded: false };
      units.set(idx, u);
    }
    return u;
  };
  for (let ti = 0; ti < must.length; ti++) {
    const re = must[ti];
    re.lastIndex = 0;
    for (const m of section.text.matchAll(re)) {
      if (!m[0]) continue;
      const idx = unitAt(section.starts, m.index);
      const start = section.starts[idx];
      const u = entry(idx);
      u.ranges.push([m.index - start, m.index - start + m[0].length]);
      u.terms.add(ti);
    }
  }
  for (const re of not) {
    re.lastIndex = 0;
    for (const m of section.text.matchAll(re)) {
      if (!m[0]) continue;
      entry(unitAt(section.starts, m.index)).excluded = true;
    }
  }
  return units;
}

/** Cut a long unit to ~limit characters around the first match, keeping the ranges in step. */
function truncateAround(text, ranges, limit = SNIPPET_CHARS) {
  if (text.length <= limit) return { text, ranges };
  const first = ranges.length ? ranges[0] : [0, 0];
  let start = Math.max(0, first[0] - Math.floor(limit / 3));
  let end = Math.min(text.length, start + limit);
  if (end === text.length) start = Math.max(0, end - limit);
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < first[0]) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > first[1]) end = sp;
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const shift = prefix.length - start;
  return {
    text: prefix + text.slice(start, end) + suffix,
    ranges: ranges.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s + shift, e + shift]),
  };
}

function inScope(doc, { bodySet, from, to, idSet }) {
  if (idSet && !idSet.has(doc.meetingId)) return false;
  if (bodySet && !bodySet.has(doc.body)) return false;
  if (from || to) {
    if (!doc.date) return false;
    if (from && doc.date < from) return false;
    if (to && doc.date > to) return false;
  }
  return true;
}

function sectionsOf(corpus, doc, kinds) {
  const out = [];
  for (const kind of ALL_KINDS) {
    if (!kinds.has(kind)) continue;
    const section = corpus.section(doc.meetingId, kind);
    if (section && section.units.length) out.push({ kind, section });
  }
  return out;
}

function toSnippet(kind, unit, ranges) {
  const merged = mergeRanges(ranges);
  const cut = truncateAround(unit.text, merged);
  return {
    kind,
    sec: unit.sec != null ? unit.sec : null,
    time: unit.time || null,
    speaker: unit.speaker || null,
    text: cut.text,
    ranges: cut.ranges,
    index: unit.i,
  };
}

/**
 * Search the corpus. A meeting matches when every term and phrase appears
 * somewhere in its selected kinds of text and no excluded term does; `hits`
 * counts the turns and paragraphs that contain at least one term.
 */
function search(corpus, text, options = {}) {
  const {
    kinds = ALL_KINDS,
    bodies = null,
    from = null,
    to = null,
    sort = "relevance",
    limit = 50,
    snippetLimit = 5,
    meetingIds = null,
  } = options;
  const query = parseQuery(text);
  const result = { query, total: 0, hits: 0, meetings: [] };
  const patterns = compile(query);
  if (!patterns.must.length) return result;

  const scope = {
    bodySet: Array.isArray(bodies) && bodies.length ? new Set(bodies) : null,
    idSet: Array.isArray(meetingIds) && meetingIds.length ? new Set(meetingIds) : null,
    from: from || null,
    to: to || null,
  };
  const kindSet = new Set(Array.isArray(kinds) && kinds.length ? kinds : ALL_KINDS);
  const matched = [];

  for (const doc of corpus.docs) {
    if (!inScope(doc, scope)) continue;
    const sections = sectionsOf(corpus, doc, kindSet);
    if (!sections.length) continue;
    if (!patterns.must.every((re) => sections.some((s) => test(re, s.section.text)))) continue;
    if (patterns.not.some((re) => sections.some((s) => test(re, s.section.text)))) continue;

    const found = [];
    for (const { kind, section } of sections) {
      for (const [idx, u] of scanSection(section, { must: patterns.must, not: [] })) {
        found.push({ kind, unit: section.units[idx], ranges: u.ranges, termCount: u.terms.size, kindOrder: ALL_KINDS.indexOf(kind) });
      }
    }
    if (!found.length) continue;
    found.sort(
      (a, b) =>
        b.termCount - a.termCount || b.ranges.length - a.ranges.length || a.kindOrder - b.kindOrder || a.unit.i - b.unit.i
    );
    matched.push({
      meetingId: doc.meetingId,
      clipId: doc.clipId,
      date: doc.date,
      title: doc.title,
      body: doc.body,
      playerUrl: doc.playerUrl,
      hits: found.length,
      snippets: found.slice(0, Math.max(0, snippetLimit)).map((f) => toSnippet(f.kind, f.unit, f.ranges)),
    });
    result.hits += found.length;
  }

  const byDate = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title).localeCompare(String(b.title));
  matched.sort(sort === "date" ? byDate : (a, b) => b.hits - a.hits || byDate(a, b));
  result.total = matched.length;
  result.meetings = matched.slice(0, Math.max(0, limit));
  return result;
}

/** Talk time per automatic speaker label: [{ speaker, turns, seconds, words }] by seconds desc. */
function speakerStats(corpus, meetingId) {
  const doc = corpus.get(meetingId);
  if (!doc || !doc.transcript) return [];
  const turns = doc.transcript.turns;
  const stats = new Map();
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const speaker = t.speaker || "Unknown";
    const words = t.text.split(/\s+/).filter(Boolean).length;
    let seconds = 0;
    if (t.sec != null) {
      let next = null;
      for (let j = i + 1; j < turns.length; j++) {
        if (turns[j].sec != null) {
          next = turns[j].sec;
          break;
        }
      }
      const spoken = words / 2.5; // ~150 words a minute
      if (next != null && next >= t.sec) seconds = Math.min(next - t.sec, spoken + 30);
      else if (doc.durationSec && doc.durationSec > t.sec) seconds = Math.min(doc.durationSec - t.sec, spoken + 30);
      else seconds = spoken;
    } else {
      seconds = words / 2.5;
    }
    const s = stats.get(speaker) || { speaker, turns: 0, seconds: 0, words: 0 };
    s.turns += 1;
    s.seconds += seconds;
    s.words += words;
    stats.set(speaker, s);
  }
  return [...stats.values()]
    .map((s) => ({ ...s, seconds: Math.round(s.seconds) }))
    .sort((a, b) => b.seconds - a.seconds || b.words - a.words);
}

module.exports = {
  ALL_KINDS,
  parseQuery,
  compile,
  search,
  highlightRanges,
  countMatches,
  speakerStats,
  scanSection,
  truncateAround,
  mergeRanges,
  unitAt,
  inScope,
  patternFor,
  escapeRe,
};

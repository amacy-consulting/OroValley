/** Ask a question across meetings. The question's words are scored against
 *  every transcript turn (BM25-style), the best turns are widened to short
 *  passages with their neighbours, and The AI model answers from those passages
 *  only, citing passage numbers. Nothing here is published; it is a research
 *  aid for Town Clerk staff.
 */
"use strict";

const { SummaryError, CancelledError } = require("./errors");
const { MODEL, friendlyApiError } = require("./summarize");
const { escapeRe, unitAt, inScope } = require("./search");

const MAX_OUTPUT_TOKENS = 8000;
const NEIGHBOUR_TURNS = 2;
const PASSAGE_CHARS = 1500;
const K1 = 1.2;
const B = 0.75;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STOP_WORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him " +
    "himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other " +
    "our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these " +
    "they this those through to too under until up very was we were what when where which while who whom why will with would " +
    "you your yours yourself yourselves also did does done ever get gets got going gone like many much one ones said say says " +
    "see seen still tell thing things think took want wants way well went were whether yes yet " +
    "meeting meetings council town discuss discussed discussion anything something someone everything happen happened happens " +
    "mention mentioned talk talked talking know knows"
  ).split(/\s+/)
);

/** Crude stem so "parks", "park's" and "park" score together. */
function stem(word) {
  let w = word.replace(/['’]s$/, "").replace(/['’]$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(sses|shes|ches|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

/** Question -> distinct lower-case stems, stop words dropped. */
function tokenize(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || []) {
    const word = raw.replace(/^[-']+|[-']+$/g, "");
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    const s = stem(word);
    if (s.length < 2 || STOP_WORDS.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Regex for a stem that also catches its plural, possessive and simple verb forms. */
function stemPattern(s) {
  const base = s.endsWith("y") ? `${escapeRe(s.slice(0, -1))}(?:y|ies)` : escapeRe(s);
  return new RegExp(`(?<!\\w)${base}(?:s|es|ed|ing|'s|’s)?(?!\\w)`, "gi");
}

function fmtMeetingLabel(doc) {
  const m = String(doc.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : doc.date || "Undated";
  return `${date} ${doc.title || "Meeting"}`.trim();
}

function turnLine(turn) {
  const when = turn.time ? `[${turn.time}] ` : "";
  const who = turn.speaker ? `${turn.speaker}: ` : "";
  return `${when}${who}${turn.text}`;
}

/** Widen a seed turn to its neighbours within the character cap. */
function windowAround(turns, center, cap) {
  let lo = center;
  let hi = center;
  let chars = turns[center].text.length;
  for (let step = 1; step <= NEIGHBOUR_TURNS; step++) {
    const before = center - step;
    const after = center + step;
    if (before >= 0 && chars + turns[before].text.length <= cap) {
      lo = before;
      chars += turns[before].text.length;
    }
    if (after < turns.length && chars + turns[after].text.length <= cap) {
      hi = after;
      chars += turns[after].text.length;
    }
  }
  return { lo, hi, chars };
}

/**
 * The passages most likely to answer the question, within the character
 * budget, ordered by meeting date then time. Summaries of the meetings that
 * contributed a passage are included too (sec null).
 */
function retrievePassages(corpus, question, options = {}) {
  const { meetingIds = null, bodies = null, from = null, to = null, maxChars = 120000, maxPassages = 40 } = options;
  const terms = tokenize(question);
  if (!terms.length) return [];
  const scope = {
    idSet: Array.isArray(meetingIds) && meetingIds.length ? new Set(meetingIds) : null,
    bodySet: Array.isArray(bodies) && bodies.length ? new Set(bodies) : null,
    from: from || null,
    to: to || null,
  };
  const regexes = terms.map(stemPattern);

  // Term frequencies per turn, document frequencies per term.
  const docs = [];
  let totalTurns = 0;
  let totalChars = 0;
  const df = new Array(terms.length).fill(0);
  for (const doc of corpus.docs) {
    if (!doc.hasTranscript || !inScope(doc, scope)) continue;
    const section = corpus.section(doc.meetingId, "transcript");
    if (!section) continue;
    const tf = new Map(); // turn index -> Int array of counts per term
    for (let ti = 0; ti < regexes.length; ti++) {
      const re = regexes[ti];
      re.lastIndex = 0;
      for (const m of section.text.matchAll(re)) {
        const idx = unitAt(section.starts, m.index);
        let counts = tf.get(idx);
        if (!counts) {
          counts = new Array(terms.length).fill(0);
          tf.set(idx, counts);
        }
        if (counts[ti] === 0) df[ti] += 1;
        counts[ti] += 1;
      }
    }
    totalTurns += section.units.length;
    totalChars += section.text.length;
    if (tf.size) docs.push({ doc, section, tf });
  }
  if (!docs.length) return [];

  const avgLen = totalChars / Math.max(1, totalTurns);
  const idf = df.map((n) => Math.log(1 + (totalTurns - n + 0.5) / (n + 0.5)));
  const candidates = [];
  for (let d = 0; d < docs.length; d++) {
    const { section, tf } = docs[d];
    for (const [idx, counts] of tf) {
      const len = section.units[idx].text.length;
      let score = 0;
      let distinct = 0;
      for (let ti = 0; ti < counts.length; ti++) {
        const f = counts[ti];
        if (!f) continue;
        distinct += 1;
        score += idf[ti] * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avgLen))));
      }
      // Turns that cover more of the question's words rank first.
      score *= 1 + 0.5 * (distinct - 1);
      candidates.push({ d, idx, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.d - b.d || a.idx - b.idx);

  const kept = []; // { d, lo, hi, score, chars }
  const keptByDoc = new Map(); // d -> [kept]
  const summaryByDoc = new Map(); // d -> summary passage
  let used = 0;
  for (const c of candidates) {
    if (kept.length >= maxPassages) break;
    const { doc, section } = docs[c.d];
    const turns = section.units;
    const win = windowAround(turns, c.idx, PASSAGE_CHARS);
    const mine = keptByDoc.get(c.d) || [];
    const overlap = mine.find((k) => win.lo <= k.hi && win.hi >= k.lo);
    if (overlap) {
      overlap.score += c.score;
      continue;
    }
    let extra = win.chars + (win.hi - win.lo + 1) * 24;
    let summary = null;
    if (!summaryByDoc.has(c.d) && doc.summary) {
      summary = { d: c.d, text: doc.summary.text, chars: doc.summary.text.length };
      extra += summary.chars;
    }
    if (used + extra > maxChars) continue;
    used += extra;
    const k = { d: c.d, lo: win.lo, hi: win.hi, score: c.score, chars: win.chars };
    kept.push(k);
    mine.push(k);
    keptByDoc.set(c.d, mine);
    if (summary) summaryByDoc.set(c.d, summary);
  }
  if (!kept.length) return [];

  const passages = [];
  for (const [d, s] of summaryByDoc) {
    const { doc } = docs[d];
    passages.push({
      meetingId: doc.meetingId,
      clipId: doc.clipId,
      date: doc.date,
      title: doc.title,
      body: doc.body,
      kind: "summary",
      sec: null,
      time: null,
      text: s.text,
      score: 0,
    });
  }
  for (const k of kept) {
    const { doc, section } = docs[k.d];
    const turns = section.units.slice(k.lo, k.hi + 1);
    passages.push({
      meetingId: doc.meetingId,
      clipId: doc.clipId,
      date: doc.date,
      title: doc.title,
      body: doc.body,
      kind: "transcript",
      sec: turns[0].sec,
      time: turns[0].time,
      text: turns.map(turnLine).join("\n"),
      score: Math.round(k.score * 1000) / 1000,
    });
  }
  passages.sort(
    (a, b) =>
      String(a.date || "").localeCompare(String(b.date || "")) ||
      String(a.meetingId).localeCompare(String(b.meetingId)) ||
      (a.sec == null ? -1 : a.sec) - (b.sec == null ? -1 : b.sec)
  );
  passages.forEach((p, i) => {
    p.n = i + 1;
  });
  return passages;
}

// ---------- the the AI model call ----------

const SYSTEM_PROMPT = `You answer questions for Town Clerk staff of the Town of Oro Valley, Arizona about the Town's public meetings (Town Council, boards and commissions). Staff use your answers to find things in the record quickly, so accuracy and traceability matter more than completeness or polish.

What you are given:
- Numbered passages from automatic transcripts of meeting recordings. Each has a [HH:MM:SS] timestamp into the recording and "Speaker N" labels from automatic speaker separation. Speaker numbers are not identities: they are not names, they can drift within a meeting, and they restart between meetings. Speech-to-text also mishears names, numbers and amounts.
- Numbered summaries written by staff for some of those meetings.
- The current Council roster, for the spelling of names and titles.
- Sometimes a note about which meetings or dates the question was limited to.

Rules:
- Answer only from the supplied passages. Do not use outside knowledge about the Town, its people, or its decisions.
- Cite the passage number for every factual claim, inline, as [3] or [3][7]. A sentence of fact without a citation is not allowed.
- When the passages do not answer the question, or answer only part of it, say so plainly in the first sentence. Do not fill gaps with what is likely.
- Never guess a person's name, a dollar amount, a vote count, a date, or an item number. When a transcript is unclear on one, say it is unclear and cite the passage so staff can check the video.
- Attribute a statement to a named person only when the passage makes it clear who is speaking (a roll call, the chair recognizing someone by name, a self-introduction). Otherwise say "a Councilmember", "a staff member" or "a speaker". Never name members of the public.
- When a name in a transcript sounds like someone on the roster, use the roster's spelling and title.
- Stay neutral: report what was said, presented and decided without judging it.
- Keep answers short: a direct answer first, then supporting points as "- " bullets, each with its citations. Use Markdown, no headings larger than "###".
- Mention timestamps or meeting dates when they help staff find the moment in the recording, but the citation markers are what staff rely on.

Return two fields:
- answer: the Markdown answer with inline [n] citation markers.
- citations: one entry per passage you relied on, with its number and the short quote (under 25 words, copied verbatim from the passage) that supports the claim.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          quote: { type: "string" },
        },
        required: ["n", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "citations"],
  additionalProperties: false,
};

function rosterText(roster) {
  if (!roster) return { text: "", source: "none" };
  if (typeof roster === "string") return { text: roster, source: "built-in list" };
  return { text: String(roster.text || ""), source: roster.source || "unknown" };
}

function attr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scopeNote(scope) {
  if (!scope) return null;
  const parts = [];
  if (scope.from && scope.to) parts.push(`meetings from ${scope.from} to ${scope.to}`);
  else if (scope.from) parts.push(`meetings on or after ${scope.from}`);
  else if (scope.to) parts.push(`meetings on or before ${scope.to}`);
  if (Array.isArray(scope.bodies) && scope.bodies.length) parts.push(`bodies: ${scope.bodies.join(", ")}`);
  if (Array.isArray(scope.meetingIds) && scope.meetingIds.length) parts.push(`${scope.meetingIds.length} selected meeting(s)`);
  return parts.length ? `The question was limited to ${parts.join("; ")}.` : null;
}

/** The user turn: question, scope, roster and the numbered passages in XML-style tags. */
function buildAskPrompt({ question, passages, roster, scope = {} }) {
  const r = rosterText(roster);
  const meetings = new Set(passages.map((p) => p.meetingId));
  const blocks = passages.map((p) => {
    const label = attr(fmtMeetingLabel(p));
    const when = p.kind === "summary" ? ' kind="staff summary"' : ` time="${attr(p.time || "")}"`;
    return `<passage n="${p.n}" meeting="${label}"${when}>\n${p.text}\n</passage>`;
  });
  return [
    `Question from Town Clerk staff: ${String(question || "").trim()}`,
    scopeNote(scope),
    "",
    `<council_roster source="${attr(r.source)}">`,
    r.text,
    "</council_roster>",
    "",
    `<passages count="${passages.length}" meetings="${meetings.size}">`,
    ...blocks,
    "</passages>",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Answer a question from the corpus. Resolves
 * { answer, citations: [{ n, meetingId, clipId, date, title, sec, time, quote }], passages, model }.
 */
async function askQuestion({ question, corpus, scope = {}, roster }, { apiKey, onProgress, signal } = {}) {
  if (!apiKey) {
    throw new SummaryError("Add the Town's Anthropic API key in Settings to ask questions.", { needsKey: true, keyKind: "anthropic" });
  }
  const q = String(question || "").trim();
  if (!q) throw new SummaryError("Type a question first.");
  if (onProgress) onProgress("Finding the passages that mention this…");
  const passages = retrievePassages(corpus, q, scope || {});
  if (!passages.length) {
    throw new SummaryError("No transcripts match that question yet. Transcribe some meetings first.");
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: 600000 });

  let resp;
  try {
    if (signal && signal.aborted) throw new CancelledError();
    if (onProgress) onProgress(`Reading ${passages.length} passages…`);
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildAskPrompt({ question: q, passages, roster, scope }) }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        // If a safety check wrongly declines a transcript, the API retries on
        // Anthropic's recommended backup model within the same request.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      },
      { signal }
    );
    let chars = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      if (onProgress) onProgress(`Answering… ${chars.toLocaleString()} characters`);
    });
    resp = await stream.finalMessage();
  } catch (e) {
    if (e instanceof CancelledError || (signal && signal.aborted)) throw new CancelledError();
    throw friendlyApiError(e, Anthropic);
  }

  if (resp.stop_reason === "refusal") {
    const category = (resp.stop_details && resp.stop_details.category) || "unspecified";
    throw new SummaryError(`The AI model declined to answer this question (automated safety check: ${category}). Try rewording it.`);
  }
  if (resp.stop_reason === "max_tokens") {
    throw new SummaryError("The AI model ran out of room before finishing the answer. Try a narrower question.");
  }

  const reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new SummaryError("The reply wasn't in the expected format. Try again.");
  }
  const byN = new Map(passages.map((p) => [p.n, p]));
  const citations = [];
  const seen = new Set();
  for (const c of Array.isArray(parsed.citations) ? parsed.citations : []) {
    const n = Number(c && c.n);
    const p = byN.get(n);
    if (!p || seen.has(n)) continue;
    seen.add(n);
    citations.push({
      n,
      meetingId: p.meetingId,
      clipId: p.clipId,
      date: p.date,
      title: p.title,
      sec: p.sec,
      time: p.time,
      quote: String((c && c.quote) || "").trim(),
    });
  }
  citations.sort((a, b) => a.n - b.n);
  return { answer: String(parsed.answer || "").trim(), citations, passages, model: resp.model || MODEL };
}

module.exports = {
  askQuestion,
  retrievePassages,
  buildAskPrompt,
  SYSTEM_PROMPT,
  OUTPUT_SCHEMA,
  tokenize,
  stem,
  STOP_WORDS,
  MODEL,
  MAX_OUTPUT_TOKENS,
  fmtMeetingLabel,
};

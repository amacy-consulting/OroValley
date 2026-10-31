/** The Town of Oro Valley's two meeting systems, behind one facade.
 *
 *  - Swagit (orovalleyaz.new.swagit.com) hosts the meeting video. The video
 *    page gives the HLS stream, the agenda chapter index and the Destiny agenda
 *    number; /videos/<id>/download redirects to a signed MP4. Swagit's own
 *    category listings only hold 2013-2014 videos, so it is never used to list.
 *  - Destiny AgendaQuick (destinyhosted.com, id 67682) has the monthly meeting
 *    list (with the Swagit video link for each meeting), the agendas and the
 *    published minutes.
 *
 *  All parsers are pure functions so the smoke test can run them against the
 *  saved pages in test-fixtures. Media requests need a browser User-Agent
 *  (the stream server answers 403 to anything else); no Referer is needed.
 */
"use strict";

const { SourceError, CancelledError } = require("./errors");

const SITE = "https://orovalleyaz.new.swagit.com";
const DESTINY = "https://destinyhosted.com";
const DESTINY_ID = 67682;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MEDIA_HEADERS = { "User-Agent": BROWSER_UA };
const DEFAULT_MONTHS_BACK = 24;
const LISTING_CONCURRENCY = 4;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- small text helpers ----------

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  sect: "§", para: "¶", copy: "©", reg: "®", trade: "™", deg: "°", frac12: "½", frac14: "¼",
  ntilde: "ñ", Ntilde: "Ñ", eacute: "é", Eacute: "É", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú",
  uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", agrave: "à", egrave: "è",
};

/** Decode HTML entities, including doubly-escaped ones like "&amp;#160;" (Swagit's index titles). */
function decodeEntities(text) {
  let s = String(text);
  for (let pass = 0; pass < 3; pass++) {
    const next = s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
        name in ENTITIES ? ENTITIES[name] : name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : m
      );
    if (next === s) break;
    s = next;
  }
  return s;
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

/** Tag-free, entity-decoded, whitespace-collapsed text of an HTML fragment. */
function cleanText(html) {
  return decodeEntities(stripTags(html)).replace(/[\s ]+/g, " ").trim();
}

/** The value of one attribute in an HTML tag, entity-decoded, or null. */
function attr(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
}

/** Outermost <tag>...</tag> blocks of html; a nested <table> stays inside the block it is in. */
function outerBlocks(html, tag) {
  const re = new RegExp(`<(/?)(${tag}|table)\\b[^>]*>`, "gi");
  const out = [];
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (start < 0) {
      if (!closing && name === tag) {
        start = m.index;
        depth = 0;
      }
      continue;
    }
    if (name === "table") {
      depth += closing ? -1 : 1;
      continue;
    }
    if (name === tag && depth <= 0) {
      out.push(html.slice(start, m.index));
      start = closing ? -1 : m.index; // an unclosed row: the next <tr> ends it
    }
  }
  if (start >= 0) out.push(html.slice(start));
  return out;
}

/** The inside of a block returned by outerBlocks (without its opening tag). */
function inner(block) {
  return String(block).replace(/^<[^>]*>/, "");
}

/** "April 16, 2025", "Apr 02, 2025", "10/07/2026" or "4/1/25" -> "2025-04-16" (or null). */
function parseDateText(text) {
  const s = String(text || "");
  let m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
    if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return `${year}-${String(parseInt(m[1], 10)).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  }
  return null;
}

/** "5:00 PM" / "5:00 p.m." -> "5:00 PM" (first time in the text), or null. */
function parseTimeText(text) {
  const m = String(text || "").match(/(\d{1,2}:\d{2})\s*([AaPp])\.?\s*[Mm]\.?/);
  return m ? `${m[1]} ${m[2].toUpperCase()}M` : null;
}

/** "2025-04-02" -> "April 2, 2025" */
function longDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTH_NAMES[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}` : "";
}

/** Local date as "YYYY-MM-DD". */
function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/** "ORO VALLEY TOWN COUNCIL REGULAR SESSION" -> "Oro Valley Town Council Regular Session" */
function titleCase(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i && SMALL_WORDS.has(w) ? w : w.replace(/(^|[-/&(])([a-z])/g, (_, p, c) => p + c.toUpperCase())))
    .join(" ");
}

function durationLabel(sec) {
  if (!sec) return "";
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ---------- meeting kinds ----------

const KIND_LABELS = {
  council: "Town Council",
  special: "Special Session",
  "work-session": "Study Session",
  pz: "Planning & Zoning",
  board: "Board / Commission",
  test: "Test",
  other: "Other",
};

/** Meeting kind from the meeting name ("Town Council Regular Session", "Planning & Zoning Commission", ...). */
function classifyMeeting(title) {
  const n = String(title || "").toLowerCase();
  if (/system\s*test|^\s*test\b|\btest\s*(video|recording|event)|new event|audio issue/.test(n)) return "test";
  if (/planning|zoning|p\s*&\s*z\b|\bpzc\b/.test(n)) return "pz";
  if (/board|commission|committee|subcommittee|corporation|trust|retirement|authority|task force|working group|stakeholder/.test(n)) return "board";
  if (/study\s*session|work\s*session|workshop|retreat/.test(n)) return "work-session";
  if (/special/.test(n)) return "special";
  if (/council/.test(n)) return "council";
  return "other";
}

/** The public body that met: "Town Council", "Planning & Zoning Commission", "Budget and Finance Commission", ... */
function bodyOf(title, kind = classifyMeeting(title)) {
  if (kind === "council" || kind === "special" || kind === "work-session") return "Town Council";
  if (kind === "pz") return "Planning & Zoning Commission";
  const cleaned = String(title || "")
    .replace(/\b(regular|special|study|work)\s+(session|meeting)\b/gi, "")
    .replace(/\b(session|meeting|hearing)\b/gi, "")
    .replace(/[-–:]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || String(title || "").trim();
}

function lowContent(kind, durationSec) {
  return kind === "test" || (durationSec != null && durationSec < 300);
}

// ---------- HTTP ----------

async function getText(url, { signal, timeoutMs = 45000, what = "the meeting website", notFound = null } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let resp;
  try {
    resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "follow",
      signal: combined,
    });
  } catch (e) {
    if (signal && signal.aborted) throw new CancelledError();
    if (e && e.name === "TimeoutError") {
      throw new SourceError(`${cap(what)} did not respond in time. Check the internet connection, then try again.`);
    }
    throw new SourceError(`Could not reach ${what} (${e.message || e}). Check the internet connection, then try again.`);
  }
  if (resp.status === 404 && notFound) throw new SourceError(notFound);
  if (!resp.ok) {
    throw new SourceError(`${cap(what)} returned an error (HTTP ${resp.status}). Try again in a few minutes.`);
  }
  try {
    return await resp.text();
  } catch (e) {
    if (signal && signal.aborted) throw new CancelledError();
    throw new SourceError(`${cap(what)} stopped responding partway through. Check the internet connection, then try again.`);
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Run fn over items with at most `limit` in flight; results in order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- URLs ----------

/** Accepts "339060", "video 339060", "/videos/339060", "/play/339060/12", or a full Swagit URL. */
function parseClipInput(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  let m = s.match(/\/(?:videos|play)\/(\d+)/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/^(?:(?:video|clip)\s*#?\s*)?(\d{1,9})$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** The Swagit player page, or the moment `sec` seconds in when given.
 *  The page reads the start time from the URL hash (`#<seconds>`) once the
 *  video starts; its own `/play/<id>/<sec>` links are JavaScript-only and
 *  return 404 when opened directly. */
function playerUrl(clipId, sec) {
  const at = sec == null || !Number.isFinite(Number(sec)) ? 0 : Math.max(0, Math.floor(Number(sec)));
  return at ? `${SITE}/videos/${clipId}#${at}` : `${SITE}/videos/${clipId}`;
}

function embedUrl(clipId) {
  return `${SITE}/videos/${clipId}/embed`;
}

/** GET of this URL (with a browser User-Agent) redirects to a signed MP4 that lasts an hour; ffmpeg follows it. */
function downloadUrl(clipId) {
  return `${SITE}/videos/${clipId}/download`;
}

function destinyUrl(params) {
  const qs = new URLSearchParams({ id: String(DESTINY_ID), mt: "ALL", ...params });
  return `${DESTINY}/agenda_publish.cfm?${qs.toString()}`;
}

function agendaUrlFor(seq) {
  return seq ? destinyUrl({ dsp: "ag", seq: String(seq) }) : null;
}

function minutesUrlFor(seq) {
  return seq ? destinyUrl({ dsp: "min", seq: String(seq) }) : null;
}

// ---------- Swagit: video page ----------

/** Chapter list of the video page: [{ id, start, end, title, level }], start/end in seconds or null. */
function parseIndex(html) {
  const h = String(html);
  let start = h.search(/id="video-index"/);
  if (start < 0) return [];
  let end = h.indexOf('id="video-index-sm"', start);
  if (end < 0) end = h.length;
  const panel = h.slice(start, end);

  const out = [];
  const seen = new Set();
  const stack = []; // true for each open <div class="cpx"> (a parent's children box)
  const re = /<div\b[^>]*>|<\/div>|<span\b[^>]*class="playerControl"[^>]*>/gi;
  let m;
  while ((m = re.exec(panel))) {
    const tag = m[0];
    if (tag.startsWith("</div")) {
      stack.pop();
    } else if (/^<div/i.test(tag)) {
      stack.push(/\bclass="[^"]*\bcpx\b/i.test(tag));
    } else {
      const id = parseInt(attr(tag, "data-id") || "", 10);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const ts = attr(tag, "data-ts");
      const endTs = attr(tag, "data-end-ts");
      out.push({
        id,
        start: ts !== null && ts !== "" && Number.isFinite(Number(ts)) ? Number(ts) : null,
        end: endTs !== null && endTs !== "" && Number.isFinite(Number(endTs)) ? Number(endTs) : null,
        title: cleanText(attr(tag, "data-title") || ""),
        level: stack.filter(Boolean).length,
      });
    }
  }
  return out;
}

/** The Swagit video page -> { clipId, title, date, hlsUrl, agendaSeq, index }. */
function parseVideoHtml(html) {
  const h = String(html);
  const titleM = h.match(/<title>([\s\S]*?)<\/title>/i);
  const rawTitle = titleM ? cleanText(titleM[1]) : "";
  // "Apr 02, 2025 Town Council Regular Session - Oro Valley, AZ"
  const tm = rawTitle.match(/^([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\s*(.*?)\s*(?:-\s*Oro Valley,?\s*AZ)?\s*$/i);
  const date = tm ? parseDateText(tm[1]) : parseDateText(rawTitle);
  const title = (tm ? tm[2] : rawTitle.replace(/\s*-\s*Oro Valley,?\s*AZ\s*$/i, "")).trim();

  let hlsUrl = null;
  const src = h.match(/player\.src\(\{[^}]*?src:\s*"([^"]+\.m3u8[^"]*)"/i) || h.match(/file:\s*"([^"]+\.m3u8[^"]*)"/i);
  if (src) hlsUrl = decodeEntities(src[1]);
  if (hlsUrl && hlsUrl.startsWith("//")) hlsUrl = "https:" + hlsUrl;

  const ag = h.match(/destinyhosted\.com\/agenda_publish\.cfm\?([^"'\s]+)/i);
  let agendaSeq = null;
  if (ag) {
    const seq = decodeEntities(ag[1]).match(/(?:^|&)seq=(\d+)/);
    if (seq) agendaSeq = parseInt(seq[1], 10);
  }
  const idM = h.match(/\/(?:play|videos)\/(\d+)/);
  return {
    clipId: idM ? parseInt(idM[1], 10) : null,
    title,
    date,
    hlsUrl,
    agendaSeq,
    index: parseIndex(h),
    // Swagit video numbers are shared by all its customers; /videos/1 here is another town's video.
    oroValley: /Oro Valley,?\s*AZ/i.test(rawTitle) || /\/orovalleyaz\//i.test(hlsUrl || ""),
  };
}

async function fetchVideo(clipId, { signal } = {}) {
  const html = await getText(`${SITE}/videos/${clipId}`, {
    signal,
    what: "the Swagit video page",
    notFound: `Swagit has no video numbered ${clipId}. Check the link or pick another meeting.`,
  });
  const info = parseVideoHtml(html);
  if (!info.oroValley) {
    throw new SourceError(`Video ${clipId} is not an Oro Valley recording (Swagit numbers videos across all its customers). Check the link.`);
  }
  if (!info.hlsUrl) {
    throw new SourceError(`Swagit shows no video stream for recording ${clipId}. It may still be processing; try again later.`);
  }
  return info;
}

/** Sum of the #EXTINF segment lengths of an HLS chunklist, in whole seconds, or null. */
function chunklistDuration(m3u8Text) {
  let total = 0;
  let n = 0;
  for (const m of String(m3u8Text || "").matchAll(/#EXTINF:\s*([\d.]+)/g)) {
    total += parseFloat(m[1]);
    n++;
  }
  return n ? Math.round(total) : null;
}

/** Recording length from the stream's chunklist (the only place Swagit states it), or null if unreadable. */
async function fetchHlsDuration(hlsUrl, { signal } = {}) {
  if (!hlsUrl) return null;
  try {
    const playlist = await getText(hlsUrl, { signal, timeoutMs: 30000, what: "the video stream" });
    // A master playlist names the chunklist (same folder); a media playlist is the chunklist itself.
    const ref = playlist
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    let text = playlist;
    if (ref && /\.m3u8/i.test(ref)) {
      text = await getText(new URL(ref, hlsUrl).href, { signal, timeoutMs: 30000, what: "the video stream" });
    }
    return chunklistDuration(text);
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    return null;
  }
}

/** Swagit publishes no captions; kept so the pipeline's "captions first" step still works. */
async function fetchCaptions() {
  return "";
}

// ---------- Destiny: monthly meeting list ----------

/** Build the listing entry for one Destiny row; clipId is null when the row has no video yet. */
function listingEntry({ clipId, title, date, agendaSeq, minutesSeq }) {
  const kind = classifyMeeting(title);
  return {
    clipId,
    title,
    date,
    time: null, // the listing has no times; the agenda page does
    durationSec: null, // Destiny does not know it; resolveClip reads it from the stream
    durationLabel: "",
    kind,
    kindLabel: KIND_LABELS[kind],
    body: bodyOf(title, kind),
    agendaUrl: agendaUrlFor(agendaSeq),
    agendaSeq: agendaSeq || null,
    minutesUrl: minutesUrlFor(minutesSeq),
    minutesSeq: minutesSeq || null,
    playerUrl: clipId ? playerUrl(clipId) : null,
    lowContent: lowContent(kind, null),
  };
}

/**
 * Parse one monthly Destiny listing page. Pure. Returns every row (agenda-only
 * rows have clipId null), newest first. {month, year} only label errors.
 */
function parseListingHtml(html, { month, year } = {}) {
  const h = String(html);
  const tableM = h.match(/<table\b[^>]*id="meeting-table"[^>]*>[\s\S]*?<\/table>/i);
  if (!tableM) {
    if (/name="mt"|Select Meeting Type|id="nothingfound"|No meetings|nothingFound/i.test(h)) return [];
    const when = month && year ? ` for ${MONTH_NAMES[month - 1]} ${year}` : "";
    throw new SourceError(`The meeting list${when} could not be read; the agenda website's layout may have changed. Contact IT.`);
  }
  const rows = [];
  for (const row of outerBlocks(tableM[0], "tr")) {
    const cells = outerBlocks(row, "td").map(inner);
    if (cells.length < 2) continue;
    const agendaTag = cells[0].match(/<a\b[^>]*>/i);
    const agendaHref = agendaTag ? attr(agendaTag[0], "href") || "" : "";
    const seqM = agendaHref.match(/[?&]seq=(\d+)/);
    const agendaSeq = seqM ? parseInt(seqM[1], 10) : null;
    const date = parseDateText(cleanText(cells[0])) || parseDateText(agendaTag ? attr(agendaTag[0], "title") || "" : "");
    const title = cleanText(cells[1]);
    if (!title || !date) continue; // the header row, or a note
    const minutesM = (cells[2] || "").match(/<a\b[^>]*>/i);
    const minutesHref = minutesM ? attr(minutesM[0], "href") || "" : "";
    const minSeq = /dsp=min/.test(minutesHref) ? minutesHref.match(/[?&]seq=(\d+)/) : null;
    const videoM = row.match(/swagit\.com\/videos\/(\d+)/i);
    rows.push(
      listingEntry({
        clipId: videoM ? parseInt(videoM[1], 10) : null,
        title,
        date,
        agendaSeq,
        minutesSeq: minSeq ? parseInt(minSeq[1], 10) : null,
      })
    );
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.clipId || 0) - (a.clipId || 0));
  return rows;
}

/** [{month, year}] for the current month and the `count` before it, newest first. */
function monthsBackFrom(now, count) {
  const out = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i <= count; i++) {
    out.push({ month: m, year: y });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

async function fetchListingMonth({ month, year }, { signal } = {}) {
  const url = destinyUrl({ get_month: String(month), get_year: String(year) });
  const what = `the agenda website's meeting list for ${MONTH_NAMES[month - 1]} ${year}`;
  let html;
  try {
    html = await getText(url, { signal, what });
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    html = await getText(url, { signal, what }); // one retry: 25 requests make a hiccup likely
  }
  return parseListingHtml(html, { month, year });
}

/**
 * Meetings that have a video, newest first: the current month and the previous
 * `monthsBack` months of the Destiny listing (default 24), a few months at a time.
 */
async function listMeetings({ signal, monthsBack = DEFAULT_MONTHS_BACK, now = new Date() } = {}) {
  const months = monthsBackFrom(now, Math.max(0, monthsBack));
  const pages = await mapLimit(months, LISTING_CONCURRENCY, (m) => fetchListingMonth(m, { signal }));
  const seen = new Set();
  const meetings = [];
  for (const row of pages.flat()) {
    if (!row.clipId || seen.has(row.clipId)) continue;
    seen.add(row.clipId);
    meetings.push(row);
  }
  meetings.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.clipId - a.clipId);
  return meetings;
}

/**
 * Posted agendas for meetings dated today or later (this month and next),
 * soonest first. Same row shape as listMeetings; clipId is usually null.
 */
async function listUpcoming({ signal, now = new Date() } = {}) {
  const today = todayIso(now);
  const thisMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const nextMonth = thisMonth.month === 12 ? { month: 1, year: thisMonth.year + 1 } : { month: thisMonth.month + 1, year: thisMonth.year };
  const pages = await mapLimit([thisMonth, nextMonth], 2, (m) => fetchListingMonth(m, { signal }));
  return pages
    .flat()
    .filter((row) => row.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.agendaSeq || 0) - (b.agendaSeq || 0));
}

// ---------- Destiny: agenda page ----------

const EMPTY_AGENDA = Object.freeze({
  date: null, time: null, title: "", agendaText: "", items: [], packetUrl: null, amended: false,
});

const ITEM_NUMBER = /^(\d{1,3}|[A-Za-z]|[IVXLivxl]{1,6})\.?$/;

/**
 * A Destiny agenda page -> { date, time, title, agendaText, items, packetUrl, amended }.
 * items: [{ number, text, level, memoUrl, heading }]; headings are level 0 with
 * number "", items under them level 1 (level 2 for a sub-item in the next column).
 * agendaText is the indented, readable rendering that is fed to Claude ("" when
 * the page has no agenda).
 */
function parseAgendaHtml(html) {
  const h = String(html);
  if (/An error occurred\.|agenda is not available at this time/i.test(h)) return { ...EMPTY_AGENDA };
  const body = (h.match(/<body[\s\S]*$/i) || [h])[0];

  // Packet PDF
  let packetUrl = null;
  for (const tag of body.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, "href") || "";
    if (/\bid="pdf"/i.test(tag) || /\.pdf(\?|$)/i.test(href)) {
      packetUrl = new URL(href, DESTINY).href;
      break;
    }
  }

  // Header block: "*AMENDED (4/1/25, 11:30 AM) / AGENDA / ORO VALLEY TOWN COUNCIL / REGULAR SESSION / APRIL 2, 2025 / ..."
  let date = null;
  let title = "";
  let amended = false;
  const headerM = body.match(/<td\b[^>]*class="[^"]*contentwrapper[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
  if (headerM) {
    const lines = headerM[1].split(/<br\s*\/?>/i).map(cleanText).filter(Boolean);
    amended = lines.some((l) => /amended/i.test(l));
    const dateAt = lines.findIndex((l) => parseDateText(l) && !/amended/i.test(l));
    if (dateAt >= 0) date = parseDateText(lines[dateAt]);
    const titleLines = (dateAt >= 0 ? lines.slice(0, dateAt) : lines).filter((l) => !/amended|^agenda$/i.test(l));
    title = titleCase(titleLines.join(" "));
  }

  // Rows of the agenda table: headings (<strong> in a mediumText cell) and numbered items.
  const items = [];
  for (const row of outerBlocks(body, "tr")) {
    const cells = outerBlocks(row, "td");
    if (!cells.length) continue;
    if (cells.length <= 2) {
      const cell = cells[0];
      if (!/class="[^"]*mediumText/i.test(cell) || !/<strong\b/i.test(cell)) continue;
      const text = cleanText(inner(cell));
      if (!text) continue;
      items.push({ number: "", text, level: 0, memoUrl: null, heading: true });
      continue;
    }
    const texts = cells.map((c) => cleanText(inner(c)));
    let col = -1;
    for (let i = 0; i < Math.min(4, cells.length); i++) {
      if (texts[i] && ITEM_NUMBER.test(texts[i])) {
        col = i;
        break;
      }
    }
    if (col < 0) continue;
    let textAt = -1;
    for (let i = cells.length - 1; i > col; i--) {
      if (texts[i]) {
        textAt = i;
        break;
      }
    }
    if (textAt < 0) continue;
    const number = texts[col].replace(/\.$/, "") + ".";
    const memoTag = (row.match(/<a\b[^>]*>/gi) || []).find((t) => /View Agenda Memo/i.test(t) || /dsp=agm|dsp&#x3d;agm/i.test(t));
    const memoHref = memoTag ? attr(memoTag, "href") : null;
    items.push({
      number,
      text: texts[textAt],
      level: Math.max(1, col),
      memoUrl: memoHref ? new URL(memoHref, DESTINY).href : null,
      heading: false,
    });
  }

  const rendered = items.map((it) => `${"    ".repeat(it.level)}${it.number ? `${it.number} ` : ""}${it.text}`);
  const time = parseTimeText(rendered.join("\n")) || (headerM ? parseTimeText(cleanText(headerM[1]).replace(/amended[^)]*\)/i, "")) : null);
  const header = [title, longDate(date), time, amended ? "(amended agenda)" : ""].filter(Boolean).join(" | ");
  const hasContent = items.some((it) => !it.heading) || items.length >= 3;
  return {
    date,
    time,
    title,
    agendaText: hasContent ? `${header}\n\n${rendered.join("\n")}` : "",
    items,
    packetUrl,
    amended,
  };
}

/** The posted agenda for a clip (uses its agendaSeq) or a Destiny agenda number; agendaText is "" when none. */
async function fetchAgenda(clipOrSeq, { signal } = {}) {
  const seq = typeof clipOrSeq === "number" ? clipOrSeq : clipOrSeq && clipOrSeq.agendaSeq;
  if (!seq) return { ...EMPTY_AGENDA, seq: null, url: null };
  const url = agendaUrlFor(seq);
  const html = await getText(url, { signal, what: "the agenda website" });
  return { ...parseAgendaHtml(html), seq, url };
}

// ---------- Destiny: published minutes ----------

/** A Destiny minutes page -> { text }: headings on their own lines, items, motions and votes. "" when none. */
function parseMinutesHtml(html) {
  const h = String(html);
  if (/An error occurred\.|not available at this time/i.test(h)) return { text: "" };
  let body = (h.match(/<div id="content">[\s\S]*$/i) || h.match(/<body[\s\S]*$/i) || [h])[0];
  for (const marker of [/<table\b[^>]*id="nav"/i, /name="srchEngine_form"/i, /GO TO (THE TOP OF THE|PREVIOUS) PAGE/i, /AgendaQuick\s*&copy;/i]) {
    const at = body.search(marker);
    if (at > 0) body = body.slice(0, at);
  }
  body = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<tr\b[^>]*class="buttons"[^>]*>[\s\S]*?<\/tr>/i, " ")
    // Section headings sit alone in a full-width cell: give them a blank line above.
    .replace(/<td\b[^>]*colspan="8"[^>]*>\s*<span\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<\/span>/gi, "\n\n\u0001$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|h\d|li|table|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\b[^>]*>/gi, "  ")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[\s ]+/g, " ").trim())
    .map((l) => l.replace(/^(\S{1,4}\.)\s+\1\s+/, "$1 ")); // "A. A. Minutes" from a nested cell
  const out = [];
  let pendingNumber = null; // an item number whose text sits in the next row: "1." then the item
  for (const line of lines) {
    const heading = line.startsWith("\u0001");
    let text = heading ? line.slice(1).trim() : line;
    if (!text) {
      if (!pendingNumber && out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (!heading && /^(\d{1,3}|[A-Za-z]|[IVXivx]{1,6})\.$/.test(text)) {
      pendingNumber = text;
      continue;
    }
    if (pendingNumber) {
      if (!heading) text = `${pendingNumber} ${text}`;
      pendingNumber = null;
    }
    if (heading && out.length && out[out.length - 1] !== "") out.push("");
    out.push(text);
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: /MINUTES/i.test(text) || text.length > 200 ? text : "" };
}

/** Published minutes for a Destiny minutes number (or a clip with minutesSeq): { text } ("" when none). */
async function fetchPublishedMinutes(seqOrClip, { signal } = {}) {
  const seq = typeof seqOrClip === "number" ? seqOrClip : seqOrClip && seqOrClip.minutesSeq;
  if (!seq) return { text: "", seq: null, url: null };
  const url = minutesUrlFor(seq);
  const html = await getText(url, { signal, what: "the agenda website" });
  return { ...parseMinutesHtml(html), seq, url };
}

// ---------- resolve ----------

/**
 * Everything the pipeline and the dashboard need for one video. `listing`
 * (optional, from listMeetings) supplies the date, agenda and minutes links;
 * the video page supplies the rest, and the stream's chunklist the length.
 */
async function resolveClip(input, { listing = null, signal } = {}) {
  const clipId = typeof input === "number" ? input : parseClipInput(input);
  if (!clipId) {
    throw new SourceError(
      "That does not look like a Swagit video link. Paste the link from the video page " +
        "(it contains /videos/ or /play/) or just the video number."
    );
  }
  const meta = listing ? listing.find((m) => m.clipId === clipId) : null;
  const video = await fetchVideo(clipId, { signal });
  const durationSec = (meta && meta.durationSec) || (await fetchHlsDuration(video.hlsUrl, { signal }));
  const title = (meta && meta.title) || video.title || `Video ${clipId}`;
  const kind = classifyMeeting(title);
  const agendaSeq = (meta && meta.agendaSeq) || video.agendaSeq || null;
  const minutesSeq = (meta && meta.minutesSeq) || null;
  return {
    clipId,
    title,
    date: (meta && meta.date) || video.date || null,
    time: (meta && meta.time) || null,
    durationSec,
    durationLabel: durationLabel(durationSec),
    kind,
    kindLabel: KIND_LABELS[kind],
    body: bodyOf(title, kind),
    agendaUrl: agendaUrlFor(agendaSeq),
    agendaSeq,
    minutesUrl: minutesUrlFor(minutesSeq),
    minutesSeq,
    playerUrl: playerUrl(clipId),
    hlsUrl: video.hlsUrl,
    mp4Url: downloadUrl(clipId),
    index: video.index,
    lowContent: lowContent(kind, durationSec),
    source: meta ? "listing" : "video",
  };
}

module.exports = {
  SITE,
  DESTINY,
  DESTINY_ID,
  BROWSER_UA,
  MEDIA_HEADERS,
  KIND_LABELS,
  classifyMeeting,
  bodyOf,
  durationLabel,
  parseClipInput,
  playerUrl,
  embedUrl,
  downloadUrl,
  agendaUrlFor,
  minutesUrlFor,
  listMeetings,
  listUpcoming,
  resolveClip,
  fetchVideo,
  fetchHlsDuration,
  fetchAgenda,
  fetchPublishedMinutes,
  fetchCaptions,
  parseListingHtml,
  parseVideoHtml,
  parseIndex,
  parseAgendaHtml,
  parseMinutesHtml,
  chunklistDuration,
  parseDateText,
  decodeEntities,
  cleanText,
};

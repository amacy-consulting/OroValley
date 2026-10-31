/** Small helpers shared by the views. */
import { formatDate } from "../../../widget/render.js";

export const STATUS_LABELS = { review: "Needs review", approved: "Approved", hidden: "Hidden" };

export const PENDING_LABELS = {
  add: "Approved, not yet on the website",
  update: "Edited since it was published",
  remove: "Will be removed from the website",
};

export const JOB_LABELS = {
  summary: "Writing the summary",
  transcript: "Transcribing",
  minutes: "Drafting the minutes",
  ask: "Asking Claude",
};

export const KIND_LABELS = { transcript: "Transcript", summary: "Summary", minutes: "Minutes draft" };

/** Bodies the search and ask filters offer. `kinds` are the meeting kinds each one covers. */
export const BODY_OPTIONS = [
  { key: "Town Council", label: "Town Council", kinds: ["council", "special", "work-session"] },
  { key: "Planning & Zoning Commission", label: "Planning & Zoning", kinds: ["pz"] },
  { key: "boards", label: "Boards & commissions", kinds: ["board", "other"] },
];

/** Topic colours: distinct hues that read on white, starting from the brand blue. */
export const TOPIC_COLORS = ["#236298", "#0b6a1b", "#b36b00", "#5c2a6a", "#a52a22", "#0e7c86", "#6b4700", "#3f4b56"];

export function fieldsOf(draft) {
  return {
    date: draft.date || "",
    title: draft.title || "",
    overview: draft.overview || "",
    details: draft.details || "",
    recordingUrl: draft.recordingUrl || "",
  };
}

export function hasSummary(fields) {
  return Boolean(String(fields.overview).trim() || String(fields.details).trim());
}

export function shortDate(iso) {
  return formatDate(iso, "short") || "Date needed";
}

export function savedOn(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

export function savedAtTime(iso) {
  return iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
}

export function baseName(p) {
  return String(p || "").split(/[\\/]/).pop();
}

/** "Oct 2026" for "2026-10" or "2026-10-07". */
export function monthLabel(ym, { year = true } = {}) {
  const m = String(ym || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(ym || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString("en-US", year ? { month: "short", year: "numeric" } : { month: "short" });
}

/** The last `count` months as "YYYY-MM", oldest first, ending this month. */
export function lastMonths(count, now = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** "1h 02m" talk time for the Who spoke strip. */
export function talkTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m} min`;
  return `${s} sec`;
}

/** The search query that finds a watched topic: each term as a phrase. */
export function topicQuery(topic) {
  const terms = Array.isArray(topic.terms) ? topic.terms : String(topic.terms || "").split(",");
  return terms
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (/\s/.test(t) ? `"${t}"` : t))
    .join(" ");
}

/** The terms a search query would watch as a topic: quoted phrases and plain words, minus exclusions. */
export function termsFromQuery(text) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const term = (m[1] || m[2] || "").trim();
    if (!term || term.startsWith("-") || /^(and|or|not)$/i.test(term)) continue;
    terms.push(term.replace(/\*+$/, ""));
  }
  return terms;
}

export function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

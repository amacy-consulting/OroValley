/** HTML for the meeting summaries widget. Shared by the website widget and the
 *  staff review app's preview, so reviewers see exactly what residents will see.
 */
import { escapeHtml, renderMarkdown } from "./markdown.js";

export const ARCHIVE_URL = "https://www.orovalleyaz.gov/Government/Departments/Town-Clerk/Meetings-and-Agendas";

function parseDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDate(iso, style = "long") {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ""))) return "";
  const options =
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  const date = parseDate(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", options);
}

function safeUrl(url) {
  return /^https:\/\//i.test(String(url || "")) ? escapeHtml(url) : "";
}

function durationHtml(m) {
  return m.durationMinutes ? `${Number(m.durationMinutes)} minutes` : "";
}

/** "Watch the meeting": the gold call to action on the latest card, a text link in the rows. */
function actionsHtml(m, { cta = false } = {}) {
  const watch = safeUrl(m.recordingUrl);
  if (!watch) return "";
  const cls = cta ? "ecw-link ov-btn ov-btn-cta" : "ecw-link ov-link";
  return `<p class="ecw-actions"><a class="${cls}" href="${watch}" target="_blank" rel="noopener noreferrer">Watch the meeting<span class="ecw-sr"> (opens in a new tab)</span></a></p>`;
}

function detailsHtml(m, open = false) {
  if (!String(m.details || "").trim()) return "";
  return `<details class="ecw-full"${open ? " open" : ""}><summary>Read the full summary</summary><div class="ecw-md ov-prose">${renderMarkdown(
    m.details
  )}</div></details>`;
}

/** The featured card for the most recent meeting: the system's listing card. */
export function latestHtml(m, { open = false } = {}) {
  const meta = [escapeHtml(m.title || "Town Council Meeting"), durationHtml(m)].filter(Boolean).join(" · ");
  return `<article class="ecw-latest ov-listing" aria-labelledby="ecw-latest-date">
    <p class="ecw-eyebrow">Latest meeting</p>
    <h2 class="ecw-date ov-listing-title" id="ecw-latest-date">${formatDate(m.date)}</h2>
    <p class="ecw-meta ov-listing-meta">${meta}</p>
    <div class="ecw-md ecw-overview ov-prose">${renderMarkdown(m.overview)}</div>
    ${detailsHtml(m, open)}
    ${actionsHtml(m, { cta: true })}
  </article>`;
}

/** One expandable row in the "Earlier meetings" list: an accordion item. */
export function rowHtml(m) {
  const duration = durationHtml(m);
  return `<li><details class="ecw-row">
    <summary class="ov-accordion-trigger">
      <span class="ecw-row-date">${formatDate(m.date, "short")}</span>
      <span class="ecw-row-title">${escapeHtml(m.title || "Town Council Meeting")}</span>
    </summary>
    <div class="ecw-row-body ov-accordion-body">
      ${duration ? `<p class="ecw-meta">${duration}</p>` : ""}
      <div class="ecw-md ecw-overview ov-prose">${renderMarkdown(m.overview)}</div>
      ${detailsHtml(m)}
      ${actionsHtml(m)}
    </div>
  </details></li>`;
}

export function footerHtml(updated) {
  const when = updated ? ` Updated ${formatDate(String(updated).slice(0, 10), "short")}.` : "";
  return `<footer class="ecw-footer ov-footer">
    <div class="ov-footer-bottom">
      <p>These summaries are provided for convenience and are not the official minutes.
      Official minutes are approved by the Town Council.${when}</p>
      <p><a class="ecw-link" href="${ARCHIVE_URL}" target="_blank" rel="noopener noreferrer">Agendas, minutes, and video archive<span class="ecw-sr"> (opens in a new tab)</span></a></p>
    </div>
  </footer>`;
}

/** Meetings the widget will show, newest first. */
export function visibleMeetings(data, count) {
  return (Array.isArray(data && data.meetings) ? data.meetings : [])
    .filter((m) => m && m.date && m.overview)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, count);
}

/** Everything below the widget header. */
export function contentHtml(data, count) {
  const meetings = visibleMeetings(data, count);
  if (!meetings.length) {
    return `<p class="ecw-status">No meeting summaries have been posted yet.</p>${footerHtml(data && data.updated)}`;
  }
  const [latest, ...earlier] = meetings;
  return (
    latestHtml(latest) +
    (earlier.length
      ? `<section class="ecw-recent" aria-labelledby="ecw-recent-title">
          <h2 class="ecw-section-title" id="ecw-recent-title">Earlier meetings</h2>
          <ul class="ecw-list ov-accordion">${earlier.map(rowHtml).join("")}</ul>
        </section>`
      : "") +
    footerHtml(data.updated)
  );
}

export function errorHtml() {
  return `<p class="ecw-status">Meeting summaries can't be loaded right now.</p>${footerHtml()}`;
}

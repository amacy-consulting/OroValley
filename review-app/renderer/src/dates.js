/** Date formatting for the dashboard screens. `iso` is a YYYY-MM-DD string. */

function parseDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "Wednesday, October 21, 2026" (long) or "Oct 21, 2026" (short); "" for a missing or malformed date. */
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

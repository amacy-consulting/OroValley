/** Current Mayor and Council, read from the Town's Mayor and Council page so
 *  summaries and draft minutes spell names correctly and stay current after
 *  each election. Falls back to the roster below if the page can't be read.
 *
 *  The page lists only titles and last names ("Mayor Winfield",
 *  "Councilmember Greene"); full names are taken from the built-in list when
 *  the last name matches, otherwise from the member's page address.
 */
"use strict";

const ROSTER_URL = "https://www.orovalleyaz.gov/Government/Mayor-and-Council";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// As listed on the Mayor and Council page on 2026-10-30. Used when the page can't be read,
// and for the full names behind the last names the page shows.
//
// NOTE: A new Council is sworn in on November 4, 2026 (Mayor-elect Melanie Barrett;
// Councilmembers-elect Rosa Dailey, Rhonda Piña and Matt Wood, per unofficial results).
// Update this list then. Staff titles (Clerk, Manager, Attorney) are not on the web page.
const FALLBACK_ROSTER = `Mayor Joseph C. "Joe" Winfield
Vice Mayor Melanie Barrett
Councilmember Harry "Mo" Greene II
Councilmember Joyce Jones-Ivey
Councilmember Josh Nicolson
Councilmember Mary Murphy
Councilmember Elizabeth Robb
Town Clerk Mike (Michael) Standish
Town Manager Jeff Wilkins
Town Attorney Steven Zraick`;

const TITLE_RE = /^((?:Vice[- ])?Mayor|Council\s?member|Deputy Town Clerk|Town (?:Clerk|Manager|Attorney|Engineer)|Chief of Police|Police Chief)\s+(.+)$/i;
const ENTITIES = { "&quot;": '"', "&amp;": "&", "&#39;": "'", "&nbsp;": " ", "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"' };

function decode(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] || " ");
}

/** Plain text of a page, one line per block element. */
function pageText(html) {
  return decode(
    String(html)
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/?(br|p|div|li|ul|h\d|nav|header|footer|section|table|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Normalize a title: "Vice-Mayor" -> "Vice Mayor", "Council member" -> "Councilmember". */
function normalizeTitle(title) {
  const t = String(title).replace(/\s+/g, " ").trim();
  if (/^vice[- ]mayor$/i.test(t)) return "Vice Mayor";
  if (/^council\s?member$/i.test(t)) return "Councilmember";
  if (/^mayor$/i.test(t)) return "Mayor";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Mayor Joseph C. \"Joe\" Winfield" -> [{ title, name }] for each line of a roster text. */
function rosterLines(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(TITLE_RE);
    out.push(m ? { title: normalizeTitle(m[1]), name: m[2].trim() } : { title: "", name: line });
  }
  return out;
}

/** The last name of "Joseph C. "Joe" Winfield" / "Harry "Mo" Greene II" (suffixes dropped), lower-cased. */
function lastNameOf(name) {
  const words = String(name)
    .replace(/["“”(][^"“”)]*["“”)]/g, " ")
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter((w) => w && !/^(jr\.?|sr\.?|ii|iii|iv|md|phd|esq\.?)$/i.test(w));
  return (words[words.length - 1] || "").toLowerCase();
}

/**
 * Mayor and Council links on the Town page -> [{ title, lastName, slugName }].
 * slugName is the member's name as spelled in their page address, or "" for
 * generic addresses (/Mayor, /Vice-Mayor).
 */
function parseRosterHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const text = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    // Case matters: "Mayor and Council" (a menu link) must not read as a Mayor named "and Council".
    const tm = text.match(/^((?:Vice[- ])?Mayor|Council\s?member)\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)?)$/);
    if (!tm || /^(and|or|of)\b/i.test(tm[2])) continue;
    const title = normalizeTitle(tm[1]);
    const lastName = tm[2].trim();
    const key = `${title} ${lastName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let slugName = "";
    try {
      const segment = decodeURIComponent(m[1].split("?")[0].replace(/\/+$/, "").split("/").pop() || "");
      if (!/^(mayor|vice-?mayor|council|mayor-and-council)$/i.test(segment)) {
        slugName = segment.replace(/-/g, " ").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
      }
    } catch {
      /* odd address; keep the last name only */
    }
    out.push({ title, lastName, slugName });
  }
  return out;
}

/** Roster text from the page's entries, with full names from the built-in list where the last names match. */
function buildRosterText(entries, fallbackText = FALLBACK_ROSTER) {
  const fallback = rosterLines(fallbackText);
  const members = fallback.filter((l) => /^(Mayor|Vice Mayor|Councilmember)$/.test(l.title));
  const staff = fallback.filter((l) => !/^(Mayor|Vice Mayor|Councilmember)$/.test(l.title));
  const lines = entries.map((e) => {
    const known = members.find((l) => lastNameOf(l.name) === lastNameOf(e.lastName));
    let name = e.lastName;
    if (known) {
      name = known.name;
    } else if (e.slugName) {
      // The address spells "Joyce-Jones-Ivey"; put the hyphen back where the page's last name has one.
      const parts = e.lastName.split("-").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const re = new RegExp(`${parts.join("[ -]")}(\\s|$)`, "i");
      if (re.test(e.slugName)) name = e.slugName.replace(re, `${e.lastName}$1`).trim();
    }
    return `${e.title} ${name}`;
  });
  return lines.concat(staff.map((l) => `${l.title} ${l.name}`)).join("\n");
}

function looksComplete(entries) {
  return entries.some((e) => e.title === "Mayor") && entries.filter((e) => e.title === "Councilmember").length >= 4;
}

/** Returns { text, source } where source is the page URL or "built-in list". */
async function loadCouncilRoster() {
  try {
    const resp = await fetch(ROSTER_URL, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const entries = parseRosterHtml(await resp.text());
      if (looksComplete(entries)) return { text: buildRosterText(entries), source: ROSTER_URL };
    }
  } catch {
    // fall through to the built-in list
  }
  return { text: FALLBACK_ROSTER, source: "built-in list" };
}

module.exports = {
  loadCouncilRoster,
  parseRosterHtml,
  buildRosterText,
  rosterLines,
  pageText,
  FALLBACK_ROSTER,
  ROSTER_URL,
};

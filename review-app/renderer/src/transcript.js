/** Turn a saved transcript body into rows for the viewer, and build Swagit
 *  "play from here" links. Plain ES module so the smoke test can run it
 *  outside the app.
 */

const TURN = /^\[(\d{2}):(\d{2}):(\d{2})\]\s+(Speaker [\d?]+):\s*([\s\S]*)$/;

export const SWAGIT_SITE = "https://orovalleyaz.new.swagit.com";

/** Body -> [{ kind: "turn", sec, time, speaker, text } | { kind: "note", text }] */
export function parseTranscript(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const m = block.match(TURN);
      if (!m) return { kind: "note", text: block };
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const time = Number(m[1]) ? `${Number(m[1])}:${m[2]}:${m[3]}` : `${Number(m[2])}:${m[3]}`;
      return { kind: "turn", sec, time, speaker: m[4], text: m[5].replace(/\s+/g, " ") };
    });
}

/** A stable colour class per speaker label. */
export function speakerClass(speaker) {
  const digits = String(speaker).replace(/\D/g, "");
  return digits ? `sp-${Number(digits) % 8}` : "sp-x";
}

/** "1:05:09" or "5:09" for a number of seconds. */
export function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/**
 * The Swagit page that plays a video from a given second:
 *   https://orovalleyaz.new.swagit.com/videos/<id>            (from the start)
 *   https://orovalleyaz.new.swagit.com/play/<id>/<sec>        (from `sec`)
 * `playBase` (from the main process) overrides the built-in host when given.
 */
export function playUrlFor(clipId, sec = 0, playBase = null) {
  if (!clipId) return null;
  const at = Math.max(0, Math.floor(Number(sec) || 0));
  if (!at) return `${SWAGIT_SITE}/videos/${clipId}`;
  const base = playBase ? String(playBase).replace(/\/+$/, "") : `${SWAGIT_SITE}/play/${clipId}`;
  return `${base}/${at}`;
}

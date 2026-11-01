/** Turn Swagit recordings into dashboard drafts, and flag the ones a reviewer
 *  should look at closely (tests, short or duplicate recordings, other boards).
 */
"use strict";

const COUNCIL_KINDS = new Set(["council", "special", "work-session"]);
const SHORT_RECORDING_SEC = 10 * 60;
const ID_PREFIX = "swagit-";

/** Meeting id used in the review state. */
function clipKey(clipId) {
  return `${ID_PREFIX}${clipId}`;
}

/** Swagit video number in a video link (/videos/N, /play/N/sec, /videos/N/embed), or null. */
function clipIdFromUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (!/(^|\.)swagit\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:videos|play)\/(\d+)(?:\/|$)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** The video a record is about: from its id, or from its video link. */
function recordClipId(record) {
  const m = String((record && record.id) || "").match(/^swagit-(\d+)$/);
  return m ? Number(m[1]) : clipIdFromUrl(record && record.recordingUrl);
}

/** Key a record by its Swagit video number when its id does not already say so (kept for review.js). */
function normalizeRecord(record) {
  const clipId = recordClipId(record);
  const id = clipId ? clipKey(clipId) : record.id;
  return id === record.id ? record : { ...record, id };
}

/** The "Meeting type" shown in the dashboard. */
function meetingKind(clip) {
  switch (clip.kind) {
    case "council":
      return "Regular Session";
    case "special":
      return "Special Session";
    case "work-session":
      return "Study Session";
    case "pz":
      return "Planning & Zoning Commission Meeting";
    case "board":
      return clip.body ? `${clip.body} Meeting` : "Board or Commission Meeting";
    case "test":
      return "Test Recording";
    default:
      return "Public Meeting";
  }
}

/** What the reviewer sees about the recording; refreshed from the listing each time. */
function sourceOf(clip) {
  return {
    clipId: clip.clipId,
    title: String(clip.title || ""),
    kind: clip.kind,
    kindLabel: clip.kindLabel,
    body: clip.body || null,
    time: clip.time || null,
    durationSec: clip.durationSec || null,
    durationLabel: clip.durationLabel || "",
    playerUrl: clip.playerUrl,
    agendaUrl: clip.agendaUrl || null,
    agendaSeq: clip.agendaSeq || null,
    minutesUrl: clip.minutesUrl || null,
    minutesSeq: clip.minutesSeq || null,
  };
}

/** A new draft from a listing entry. The summary starts empty; the AI model or the reviewer writes it. */
function toDraft(clip) {
  return {
    id: clipKey(clip.clipId),
    date: clip.date || null,
    title: meetingKind(clip),
    overview: "",
    details: "",
    durationMinutes: clip.durationSec ? Math.round(clip.durationSec / 60) : null,
    recordingUrl: clip.playerUrl,
    source: sourceOf(clip),
  };
}

/** Reasons a reviewer should take a closer look: [{ code, message }].
 *  Code "low-content" means the recording is hidden automatically. */
function reviewFlags(clip, listing = []) {
  const flags = [];
  const add = (code, message) => flags.push({ code, message });

  if (clip.lowContent) {
    add("low-content", "Looks like a test or an empty recording, so it was hidden automatically.");
  } else {
    if (!COUNCIL_KINDS.has(clip.kind)) {
      add("not-council", `This is a ${clip.kindLabel || "non-Council"} recording, not a Town Council meeting.`);
    }
    if (clip.durationSec && clip.durationSec < SHORT_RECORDING_SEC) {
      add("short", `The recording is only ${Math.round(clip.durationSec / 60)} minutes long.`);
    }
  }
  if (!clip.date) {
    add("no-date", "The meeting list doesn't show a date for this recording. Enter the meeting date.");
  }
  // Other real recordings of the same date; automatically hidden tests don't count.
  const sameDay = listing.filter((m) => m.clipId !== clip.clipId && m.date && m.date === clip.date && !m.lowContent);
  if (sameDay.length) {
    add(
      "same-date",
      `There ${sameDay.length === 1 ? "is another recording" : `are ${sameDay.length} other recordings`} for this date. Hide the ones you don't need.`
    );
  }
  return flags;
}

module.exports = {
  COUNCIL_KINDS,
  ID_PREFIX,
  clipKey,
  clipIdFromUrl,
  recordClipId,
  normalizeRecord,
  meetingKind,
  sourceOf,
  toDraft,
  reviewFlags,
};

/** Ask Claude to draft the official minutes of a Town of Oro Valley meeting in
 *  the Town Clerk's format, from the transcript of the Swagit recording, the
 *  posted agenda, the Swagit video index and the Council roster. The result is
 *  a draft only: the Clerk's staff edit it and export it to Word. Nothing here
 *  is published.
 */
"use strict";

const { SummaryError, CancelledError } = require("./errors");
const { MODEL, MAX_TRANSCRIPT_CHARS, friendlyApiError } = require("./summarize");

// Minutes of a three-hour meeting can run past ten pages; streaming keeps the
// request alive, so give the model plenty of room.
const MAX_OUTPUT_TOKENS = 64000;

const SYSTEM_PROMPT = `You draft the official minutes of Town of Oro Valley, Arizona public meetings for the Town Clerk's office. The draft is a starting point: Town Clerk staff review and edit every line before the minutes are adopted and published, so when you are unsure of something, say so in a reviewer note instead of guessing.

What you are given:
- The posted agenda from the Town's agenda system. It is the authority for section names, item numbers and letters, item titles, ordinance and resolution numbers, and dollar amounts. Copy item titles from it exactly, including capitalization.
- The Swagit video index: the agenda items staff marked in the recording, with the time in the recording where each begins. It maps agenda items to places in the transcript, so use it to find where each item starts and ends.
- The current Council roster, for the spelling of names and titles.
- A sample of the Town's published minutes. Match its conventions, phrasing, and level of detail. The sample may be from a different meeting (or, when it is the published minutes of this same meeting, a useful comparison); never copy its facts.
- The transcript of the recording: automatic speech-to-text with [HH:MM:SS] timestamps and "Speaker N" labels from automatic speaker separation. Timestamps count from the start of the recording; they are not clock times. Speaker numbers are not identities and can drift. Speech-to-text mishears names, numbers, and amounts.
- Sometimes the Clerk's current draft of these minutes. Keep its corrections and wording where the transcript supports them, add what it is missing, and fix only what the transcript clearly contradicts.

The Town's minutes are action minutes. They record who presented, who moved and seconded, what the motion was, and how the vote went. They do not quote or paraphrase debate, and they never editorialize.

Structure:
- Title block, then the sections in the order the agenda lists them, with each section heading in capitals exactly as the agenda names it. A regular session usually runs: REGULAR SESSION AT OR AFTER 6:00 PM, CALL TO ORDER, ROLL CALL, PLEDGE OF ALLEGIANCE, UPCOMING MEETING ANNOUNCEMENTS, MAYOR AND COUNCIL REPORTS ON CURRENT EVENTS, TOWN MANAGER'S REPORT ON CURRENT EVENTS, ORDER OF BUSINESS, INFORMATIONAL ITEMS, CALL TO AUDIENCE, PRESENTATIONS, CONSENT AGENDA, REGULAR AGENDA, FUTURE AGENDA ITEMS, ADJOURNMENT. Include EXECUTIVE SESSION and RESUME REGULAR SESSION (with its own CALL TO ORDER, and ROLL CALL when attendance changed) when the meeting had them. Use the agenda's own headings for special sessions, study sessions, and boards or commissions.
- Keep a section even when nothing happened in it, using the Town's usual sentence: "There were no informational items.", "There were no requests to speak during the Call to Audience.", "There were no future agenda items."
- CALL TO ORDER: "Mayor Winfield called the meeting to order at 6:01 p.m." ORDER OF BUSINESS: "Mayor Winfield reviewed the order of business and stated that the order would stand as posted." (or how it changed). PLEDGE OF ALLEGIANCE: who led it. UPCOMING MEETING ANNOUNCEMENTS: "Town Clerk Mike Standish announced the upcoming Town meetings and events."
- MAYOR AND COUNCIL REPORTS ON CURRENT EVENTS: one short paragraph per report in the Town's form, for example "Councilmember Murphy reported that she had attended the Golder Ranch Fire District 48th Birthday Celebration." TOWN MANAGER'S REPORT: "Town Manager Jeff Wilkins reported the following:" and a list of the topics.
- Items: number or letter each item exactly as the agenda does and give its full agenda title.
- Staff presentations: "<Title> <Name> presented <item> and included the following:" followed by a list of the slide or topic headings, only when the transcript shows them (a presenter reading slide titles or announcing topics); otherwise one sentence saying who presented what. Then "Discussion ensued among Council and staff regarding <item>." when there was discussion. Name staff by title and name only when the transcript makes it clear who they are (an introduction, the chair recognizing them).
- Public speakers: "The following individuals spoke regarding item #N:" followed by a list, as "Oro Valley resident <Name>" when they said they live in the Town, naming a speaker only when they clearly state their name. Otherwise write "A resident spoke regarding item #N." and add a reviewer note with the timestamp. Never name members of the public from anything but their own statement.
- Motions: "Motion by <Title> <Full Name>, seconded by <Title> <Full Name> to <the motion as stated>." Use full names from the roster here (Mayor Joseph C. Winfield, Vice-Mayor Melanie Barrett, Councilmember Harry Greene); elsewhere use title and last name. On its own line after the motion: "Vote: 7 - 0 Carried". When the vote was split: "Vote: 5 - 2 Carried" with "Opposed: Councilmember Josh Nicolson, Councilmember Mary Murphy" on the next line, or "Vote: 3 - 4 Failed". An abstention: "Other: Councilmember Harry Greene (ABSTAINING)". Count the vote from the roll-call vote or the voice vote when the transcript gives it; when only "all in favor" is heard and no one objects, the vote is unanimous among the members present. When you cannot confirm the count, write the most likely count and add a reviewer note. Record a motion that was amended or withdrawn the way the sample does.
- Executive session: the motion to go into executive session with its time and statutory citation from the agenda, who joined, then RESUME REGULAR SESSION with the time the chair resumed.
- Adjournment: "Motion by ..., seconded by ... to adjourn the meeting at 8:21 p.m." with its vote, or "Mayor Winfield adjourned the meeting at 8:42 p.m." when there was no motion.

Accuracy matters more than completeness. These minutes become the Town's legal record once adopted.
- Use only facts supported by the transcript, the agenda, or the current draft. When the transcript and the agenda disagree on a name, number, title, or amount, use the agenda's and add a reviewer note.
- Spell the Mayor's, Vice Mayor's, Councilmembers', and staff names exactly as in the roster. The transcript often misspells names; when a name in it sounds like someone on the roster, use the roster spelling and title. Use the name a member goes by when the roster shows one in quotes.
- Attribute a motion, second, statement, or report to a named person only when the transcript makes it clear (roll call, the chair recognizing someone by name, a self-introduction, the Clerk repeating the motion). Otherwise write "a Councilmember" and add a reviewer note with the timestamp.
- Clock times: only times stated in the transcript (the chair announcing the time, a recess, the executive session motion). Never convert a recording timestamp to a clock time. When a time was not stated, write "__:__ p.m." and add a reviewer note giving the transcript timestamp so the Clerk can check the video.
- If an agenda item does not appear in the transcript, keep the item with its title and write "This item was not discussed." only if the chair said so; otherwise leave the body empty and add a reviewer note.
- If the recording is a system test or contains no meeting business, say so in one sentence under CALL TO ORDER and leave the rest empty.
- Do not mention transcripts, recordings, recording quality, speaker labels, or how the draft was written in the minutes themselves.

Markdown conventions (the app converts this to Word and plain text, so use only these):
- First line "# MINUTES", then each line of the title block on its own line directly below it: "ORO VALLEY TOWN COUNCIL", the session type ("REGULAR SESSION", "SPECIAL SESSION", "STUDY SESSION"), the date as "NOVEMBER 19, 2025", "ORO VALLEY COUNCIL CHAMBERS", "11000 N. LA CAÑADA DRIVE". Use the body's name in place of the Council's for a board or commission.
- Each section heading as "## HEADING" in capitals.
- Each item as "1. Title" or "A. Title" on its own line with a blank line before and after, matching the agenda's numbering.
- Roll call: the line "Present:" followed by "- " bullets in the form "Joseph C. Winfield, Mayor", "Melanie Barrett, Vice-Mayor", "Harry Greene, Councilmember", in the roster's order; "Absent:" the same way when someone was absent.
- Lists of slide topics, report topics, and speakers as "- " bullets.
- Everything else as plain paragraphs separated by blank lines. No bold, italics, tables, links, or other headings.
- End with the attestation block, with blanks for the signatures:

_________________________________________
Prepared by: _______________________
Deputy Town Clerk

I hereby certify that the foregoing minutes are a true and correct copy of the minutes of the regular session of the Town of Oro Valley, Arizona held on the 19th day of November 2025. I further certify that the meeting was called and held and that a quorum was present.

_________________________________________
Mike Standish
Town Clerk

(Change "regular session" to the session type, fill in the meeting date with its ordinal, and take the Town Clerk's name from the roster.)

Return two fields:
- minutes: the Markdown draft.
- notes: reviewer notes as short plain strings, each starting with the transcript timestamp in brackets when there is one, for everything the Clerk must check: a vote count you could not confirm, a mover, seconder, or speaker you could not name, an agenda item you could not find in the transcript, a number or amount that differs between the agenda and the transcript, a time left blank, a motion whose exact wording was unclear. Empty when nothing needs checking.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    minutes: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["minutes", "notes"],
  additionalProperties: false,
};

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The Swagit video index as "[start - end] title" lines, indented by level. */
function formatIndex(index) {
  if (!Array.isArray(index) || !index.length) return "";
  return index
    .map((entry) => {
      const indent = "  ".repeat(Math.max(0, Number(entry.level) || 0));
      const start = fmtTime(entry.start);
      const end = fmtTime(entry.end);
      const when = start ? `[${start}${end ? ` - ${end}` : ""}] ` : "";
      return `${indent}${when}${String(entry.title || "").trim()}`;
    })
    .join("\n");
}

/** The posted agenda as text, from agendaText or the parsed items. */
function formatAgenda(agenda) {
  if (!agenda) return "";
  if (typeof agenda === "string") return agenda.trim();
  if (agenda.agendaText && String(agenda.agendaText).trim()) return String(agenda.agendaText).trim();
  if (Array.isArray(agenda.items) && agenda.items.length) {
    return agenda.items
      .map((it) => {
        const indent = "  ".repeat(Math.max(0, Number(it.level) || 0));
        const num = it.number ? `${it.number} ` : "";
        return `${indent}${num}${String(it.text || "").trim()}`;
      })
      .join("\n");
  }
  return "";
}

function rosterText(roster) {
  if (!roster) return { text: "", source: "none" };
  if (typeof roster === "string") return { text: roster, source: "built-in list" };
  return { text: String(roster.text || ""), source: roster.source || "unknown" };
}

/**
 * The user turn: meeting facts, roster, agenda, video index, the published
 * sample, the current draft, and the transcript, in XML-style tags.
 */
function buildUserPrompt({ clip = {}, agenda = null, transcript = "", index = null, roster = null, publishedSample = "", draft = "" }) {
  const ag = agenda && typeof agenda === "object" ? agenda : {};
  const agendaBody = formatAgenda(agenda);
  const indexBody = formatIndex(index || clip.index);
  const r = rosterText(roster);
  const sample = String(publishedSample || "").trim();
  const current = String(draft || "").trim();

  const agendaAttrs = [
    ag.date ? ` date="${ag.date}"` : "",
    ag.time ? ` time="${ag.time}"` : "",
    ag.amended ? ' amended="yes"' : "",
  ].join("");

  return [
    `Meeting: ${clip.title || ag.title || "Town Council Regular Session"}`,
    `Date: ${clip.date || ag.date || "unknown"}`,
    clip.time || ag.time ? `Posted start time: ${clip.time || ag.time}` : null,
    clip.kindLabel ? `Meeting type: ${clip.kindLabel}` : null,
    clip.body ? `Body: ${clip.body}` : null,
    clip.durationLabel ? `Recording length: ${clip.durationLabel}` : null,
    "",
    `<council_roster source="${r.source}">`,
    r.text,
    "</council_roster>",
    "",
    agendaBody
      ? `<posted_agenda${agendaAttrs}>\n${agendaBody}\n</posted_agenda>`
      : "No posted agenda is available for this meeting. Take the section order and item titles from the video index and the transcript, and add a reviewer note that the agenda was not available.",
    "",
    indexBody
      ? `<video_index note="Agenda items marked in the recording by staff. Times are [start - end] in the recording and match the transcript timestamps.">\n${indexBody}\n</video_index>`
      : "No video index is available for this meeting; find each item in the transcript yourself.",
    "",
    sample
      ? `<published_minutes_sample>\n${sample}\n</published_minutes_sample>`
      : "No sample of the Town's published minutes is available; follow the conventions above.",
    "",
    current
      ? `<current_draft>\n${current}\n</current_draft>`
      : "There is no current draft. Write new minutes from the transcript.",
    "",
    `<transcript>\n${transcript}\n</transcript>`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function normalizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.map((n) => String(n || "").trim()).filter(Boolean);
}

/**
 * Draft the minutes. Resolves { minutes, notes }: Markdown in the Town's
 * structure and the reviewer notes Claude attached.
 */
async function writeMinutes(
  { clip, agenda, transcript, index, roster, publishedSample, draft },
  { apiKey, onProgress, signal } = {}
) {
  if (!apiKey) {
    throw new SummaryError("Add the Town's Anthropic API key in Settings to draft minutes.", { needsKey: true, keyKind: "anthropic" });
  }
  const text = String(transcript || "");
  if (!text.trim()) throw new SummaryError("There is no transcript to draft minutes from.");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new SummaryError("This meeting's transcript is too long to send in one request. Draft the minutes by hand instead.");
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: 600000 });

  let resp;
  try {
    if (signal && signal.aborted) throw new CancelledError();
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt({ clip, agenda, transcript: text, index, roster, publishedSample, draft }),
          },
        ],
        output_config: {
          effort: "high",
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
      if (onProgress) onProgress(`Drafting… ${chars.toLocaleString()} characters`);
    });
    resp = await stream.finalMessage();
  } catch (e) {
    if (e instanceof CancelledError || (signal && signal.aborted)) throw new CancelledError();
    throw friendlyApiError(e, Anthropic);
  }

  if (resp.stop_reason === "refusal") {
    const category = (resp.stop_details && resp.stop_details.category) || "unspecified";
    throw new SummaryError(`Claude declined to draft minutes for this meeting (automated safety check: ${category}). Draft them by hand instead.`);
  }
  if (resp.stop_reason === "max_tokens") {
    throw new SummaryError("Claude ran out of room before finishing the minutes. Try again.");
  }

  const reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new SummaryError("Claude's reply wasn't in the expected format. Try again.");
  }
  const minutes = String(parsed.minutes || "").replace(/\r\n?/g, "\n").trim();
  if (!minutes) throw new SummaryError("Claude returned empty minutes. Try again.");
  return { minutes, notes: normalizeNotes(parsed.notes) };
}

module.exports = { writeMinutes, buildUserPrompt, formatIndex, formatAgenda, SYSTEM_PROMPT, MODEL, MAX_OUTPUT_TOKENS };

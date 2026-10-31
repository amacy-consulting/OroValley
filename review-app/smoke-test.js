/* Engine smoke test: no Electron, API keys, or network needed.
 * Swagit and Destiny pages come from saved fixtures and a fake listing; GitHub is an in-memory fake.
 * Run: npm test   (or: node smoke-test.js)
 * Add live checks (Destiny listing, Swagit video page, stream length, agenda, minutes, roster):
 *   $env:SMOKE_LIVE = "1"; node smoke-test.js
 */
"use strict";

const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const sources = require("./main/engine/sources");
const { toDraft, reviewFlags, clipKey, clipIdFromUrl, normalizeRecord, meetingKind } = require("./main/engine/meetings");
const { ReviewStore } = require("./main/engine/review");
const { PublishError } = require("./main/engine/github");

const SETTINGS = { githubRepo: "town/widget", githubBranch: "main", githubToken: "test-token" };
const fixture = (name) => fs.readFileSync(path.join(__dirname, "test-fixtures", name), "utf-8");

// ---- Fakes -----------------------------------------------------------------

/** A listing entry as parseListingHtml builds it (durationSec is only known after resolveClip). */
function clip(clipId, title, date, durationSec, { agendaSeq = clipId + 1, minutesSeq = null } = {}) {
  const kind = sources.classifyMeeting(title);
  return {
    clipId,
    title,
    date,
    time: null,
    durationSec,
    durationLabel: sources.durationLabel(durationSec),
    kind,
    kindLabel: sources.KIND_LABELS[kind],
    body: sources.bodyOf(title, kind),
    agendaUrl: sources.agendaUrlFor(agendaSeq),
    agendaSeq,
    minutesUrl: sources.minutesUrlFor(minutesSeq),
    minutesSeq,
    playerUrl: sources.playerUrl(clipId),
    lowContent: kind === "test" || (durationSec != null && durationSec < 300),
  };
}

const LISTING = [
  clip(404723, "Town Council Regular Session", "2026-10-21", 1200), // a second recording of the same night
  clip(404722, "Town Council Regular Session", "2026-10-21", 3480, { agendaSeq: 1136, minutesSeq: 1140 }),
  clip(404600, "System Test", "2026-10-20", 180, { agendaSeq: null }),
  clip(403155, "Planning & Zoning Commission", "2026-10-06", 2400, { agendaSeq: 1224, minutesSeq: 1226 }),
];
const [M4, M1, M2, M3] = LISTING.map((c) => clipKey(c.clipId));
const fakeSources = {
  async listMeetings() {
    return LISTING;
  },
};

/** GitHub contents API for one file, in memory. */
const github = { content: null, sha: null, puts: [] };
const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
  if (String(url).includes("/branches/")) return reply(String(url).endsWith("/branches/main") ? 200 : 404, {});
  assert.ok(String(url).includes("/repos/town/widget/contents/widget/data/meetings.json"), url);
  if (!options.method) {
    if (!String(url).endsWith("?ref=main")) return reply(404, {});
    if (!github.content) return reply(404, {});
    return reply(200, { sha: github.sha, content: Buffer.from(github.content).toString("base64") });
  }
  const body = JSON.parse(options.body);
  if (body.branch !== "main") return reply(422, {});
  if ((body.sha || null) !== github.sha) return reply(409, {});
  github.content = Buffer.from(body.content, "base64").toString("utf-8");
  github.sha = sha1(github.content);
  github.puts.push(body.message);
  return reply(200, { content: { sha: github.sha }, commit: { html_url: "https://github.com/commit" } });
};
function seedGithub(data) {
  github.content = JSON.stringify(data, null, 2) + "\n";
  github.sha = sha1(github.content);
}

const published = () => JSON.parse(github.content);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ov-review-"));
const byId = (store, id) => store.view().meetings.find((m) => m.id === id);
const refresh = (store, settings = SETTINGS) => store.refresh({ sources: fakeSources, settings });

// ---- Tests -----------------------------------------------------------------

async function main() {
  // Markdown renderer and date formatting shared with the widget
  const { renderMarkdown } = await import(pathToFileURL(path.join(__dirname, "..", "widget", "markdown.js")).href);
  const html = renderMarkdown("Hi <script>alert(1)</script> **bold**\n\n1. One\n   - nested\n\n2. Two\n\n[x](javascript:alert(1))");
  assert.ok(!html.includes("<script>"), "markdown must escape HTML");
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.equal((html.match(/<ol>/g) || []).length, 1, "a blank line must not restart a numbered list");
  assert.ok(html.includes("<ul><li>nested</li></ul>"), "nested bullets");
  assert.ok(!html.includes('href="javascript'), "only https links become links");
  assert.ok(!renderMarkdown("[x](http://a.example)").includes("<a "), "plain http links are not linked");
  const { formatDate } = await import(pathToFileURL(path.join(__dirname, "..", "widget", "render.js")).href);
  assert.equal(formatDate("2026-09-14", "short"), "Sep 14, 2026");
  assert.equal(formatDate(""), "", "a missing date renders as nothing, not Invalid Date");
  console.log("ok  markdown renderer");

  // Transcript viewer rows
  const { parseTranscript, speakerClass } = await import(
    pathToFileURL(path.join(__dirname, "renderer", "src", "transcript.js")).href
  );
  const rows = parseTranscript(
    "[00:00:01] Speaker 1: I'll call the meeting\nto order.\n\n[01:02:03] Speaker 2: Second.\n\n--- Part 2 of 2 (starts at 01:00:00) ---"
  );
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].time, rows[0].sec, rows[0].speaker, rows[0].text], ["0:01", 1, "Speaker 1", "I'll call the meeting to order."]);
  assert.deepEqual([rows[1].time, rows[1].sec], ["1:02:03", 3723], "hour-long times keep the hour");
  assert.equal(rows[2].kind, "note", "part markers are notes, not turns");
  assert.equal(speakerClass("Speaker 9"), "sp-1");
  assert.equal(speakerClass("Speaker ?"), "sp-x");
  console.log("ok  transcript viewer");

  // Destiny monthly listing (fixtures)
  const oct = sources.parseListingHtml(fixture("destiny-listing-2026-10-all.html"), { month: 10, year: 2026 });
  assert.equal(oct.length, 10, `parsed ${oct.length} rows for October 2026`);
  assert.equal(oct[0].clipId, 405463, "newest first");
  assert.deepEqual([oct[0].date, oct[0].title, oct[0].kind, oct[0].body], ["2026-10-28", "Town Council Special Session", "special", "Town Council"]);
  const oct7 = oct.find((m) => m.date === "2026-10-07");
  assert.deepEqual(
    [oct7.clipId, oct7.title, oct7.kind, oct7.agendaSeq, oct7.minutesSeq],
    [403338, "Town Council Regular Session", "council", 1135, 1137]
  );
  assert.equal(oct7.agendaUrl, "https://destinyhosted.com/agenda_publish.cfm?id=67682&mt=ALL&dsp=ag&seq=1135");
  assert.equal(oct7.minutesUrl, "https://destinyhosted.com/agenda_publish.cfm?id=67682&mt=ALL&dsp=min&seq=1137");
  assert.equal(oct7.playerUrl, "https://orovalleyaz.new.swagit.com/videos/403338");
  assert.equal(oct7.durationSec, null, "the listing does not know recording lengths");
  const corp = oct.find((m) => /Corrections Officer/.test(m.title));
  assert.ok(corp && corp.clipId === null && corp.agendaSeq === 1230, "agenda-only rows keep their agenda but have no video");
  assert.equal(corp.title, "Corrections Officer Retirement Plan", "<br> inside a title becomes a space");
  assert.equal(oct.find((m) => m.clipId === 405288).title, "Planning & Zoning Commission Special Session");
  assert.equal(oct.find((m) => m.clipId === 405288).kind, "pz");
  assert.equal(oct.find((m) => m.clipId === 404581).kind, "board");
  assert.equal(oct.find((m) => m.clipId === 404581).body, "Budget and Finance Commission");
  const apr = sources.parseListingHtml(fixture("destiny-listing-2025-04-tc.html"), { month: 4, year: 2025 });
  assert.deepEqual(apr.map((m) => [m.clipId, m.agendaSeq, m.minutesSeq]), [[340379, 1008, 1010], [339060, 1007, 1009]]);
  assert.throws(() => sources.parseListingHtml("<html><body>Maintenance</body></html>"), /meeting list/);
  assert.equal(sources.classifyMeeting("Town Council Study Session"), "work-session");
  assert.equal(sources.classifyMeeting("Water Utility Commission"), "board");
  assert.equal(sources.classifyMeeting("Town Council Regular Session"), "council");
  assert.equal(sources.bodyOf("Board of Adjustment Special Session"), "Board of Adjustment");
  console.log("ok  destiny listing");

  // Swagit video page (fixtures)
  const v = sources.parseVideoHtml(fixture("swagit-video-339060.html"));
  assert.deepEqual([v.clipId, v.date, v.title, v.agendaSeq], [339060, "2025-04-02", "Town Council Regular Session", 1007]);
  assert.equal(
    v.hlsUrl,
    "https://archive-stream.granicus.com/OnDemand/_definst_/mp4:swagitVideo/orovalleyaz/a42fc51e-8517-4475-8896-d062e0a4c105.mp4/playlist.m3u8"
  );
  assert.equal(v.index.length, 25, `index has ${v.index.length} chapters (one per <span>, mobile copy ignored)`);
  assert.equal(new Set(v.index.map((i) => i.id)).size, v.index.length, "chapters are unique");
  assert.deepEqual([v.index[0].start, v.index[0].end, v.index[0].level], [null, null, 0], "a heading without a time");
  assert.match(v.index[0].title, /Executive Sessions – Upon a vote/, "doubly escaped entities are decoded");
  assert.ok(!/&(amp|#\d+|ndash|nbsp);/.test(v.index.map((i) => i.title).join(" ")), "no entity leftovers");
  const callToOrder = v.index.find((i) => i.title === "2. CALL TO ORDER");
  assert.deepEqual([callToOrder.id, callToOrder.start, callToOrder.end, callToOrder.level], [25734183, 1, 10, 1]);
  assert.equal(v.index.find((i) => /CLIFTON LITIGATION/.test(i.title)).level, 2, "items nest under their heading");
  const v2 = sources.parseVideoHtml(fixture("swagit-video-405463.html"));
  assert.deepEqual([v2.date, v2.title, v2.agendaSeq, v2.index.length], ["2026-10-28", "Town Council Special Session", 1233, 11]);
  assert.equal(sources.parseVideoHtml(fixture("swagit-video-403338.html")).agendaSeq, 1135);
  assert.deepEqual(sources.parseIndex(fixture("swagit-category-regular-session.html")), [], "a page without an index");
  assert.ok(v.oroValley && v2.oroValley, "Oro Valley's own videos are recognized");
  const foreignVideo = sources.parseVideoHtml(
    '<html><head><title>Sep 12, 2007 Board Briefing - Dallas ISD, TX</title></head><body><script>player.src({type: "application/x-mpegURL", src: "http://example.net/vod/mp4:dallasisdtx/7.mp4/playlist.m3u8"});</script></body></html>'
  );
  assert.deepEqual([foreignVideo.oroValley, foreignVideo.date, foreignVideo.title], [false, "2007-09-12", "Board Briefing - Dallas ISD, TX"], "Swagit numbers videos across all its customers; another town's video is flagged");
  assert.equal(sources.classifyMeeting("OV’s Path Forward Resident Working Group Meeting"), "board");
  assert.equal(sources.bodyOf("OV’s Path Forward Resident Working Group Meeting"), "OV’s Path Forward Resident Working Group");
  assert.equal(sources.chunklistDuration("#EXTM3U\n#EXTINF:4.972,\nmedia_0.ts\n#EXTINF:4.971,\nmedia_1.ts\n"), 10);
  assert.equal(sources.chunklistDuration("#EXTM3U\n"), null);
  for (const input of ["339060", " video 339060 ", "/videos/339060", "/play/339060/12", "https://orovalleyaz.new.swagit.com/videos/339060/embed"]) {
    assert.equal(sources.parseClipInput(input), 339060, input);
  }
  assert.equal(sources.parseClipInput("https://destinyhosted.com/agenda_publish.cfm?id=67682"), null);
  assert.equal(sources.playerUrl(339060), "https://orovalleyaz.new.swagit.com/videos/339060");
  assert.equal(sources.playerUrl(339060, 131.9), "https://orovalleyaz.new.swagit.com/videos/339060#131");
  assert.equal(sources.playerUrl(339060, 0), "https://orovalleyaz.new.swagit.com/videos/339060");
  assert.equal(sources.embedUrl(339060), "https://orovalleyaz.new.swagit.com/videos/339060/embed");
  assert.deepEqual(sources.MEDIA_HEADERS, { "User-Agent": sources.BROWSER_UA }, "no Referer needed");
  assert.equal(await sources.fetchCaptions(339060), "", "Swagit has no captions");
  console.log("ok  swagit video page");

  // Destiny agenda and minutes (fixtures)
  const agenda = sources.parseAgendaHtml(fixture("destiny-agenda-1007.html"));
  assert.deepEqual([agenda.date, agenda.time, agenda.title, agenda.amended], ["2025-04-02", "5:00 PM", "Oro Valley Town Council Regular Session", true]);
  assert.equal(agenda.packetUrl, "https://destinyhosted.com/orovadocs/2025/TC/20250402_1009/AGENDApacket__04-02-25_1048_1007.pdf");
  assert.ok(agenda.items.length >= 30, `${agenda.items.length} agenda rows`);
  assert.deepEqual(agenda.items[0], { number: "", text: "REGULAR SESSION AT OR AFTER 5:00 PM", level: 0, memoUrl: null, heading: true });
  const consentA = agenda.items.find((i) => i.number === "A." && /Minutes - March 19, 2025/.test(i.text));
  assert.ok(consentA && consentA.level === 1 && /dsp=agm&seq=5997/.test(consentA.memoUrl), "items carry their memo link");
  assert.equal(agenda.items.filter((i) => i.text === "CALL TO ORDER").length, 3, "repeated headings are kept (the agenda really has three)");
  assert.match(agenda.agendaText, /^Oro Valley Town Council Regular Session \| April 2, 2025 \| 5:00 PM \| \(amended agenda\)\n\nREGULAR SESSION/);
  assert.match(agenda.agendaText, /^CONSENT AGENDA \(Consideration and\/or possible action\)\n {4}A\. Minutes - March 19, 2025\n {4}B\. /m);
  assert.match(agenda.agendaText, /§38-431\.03/, "entities are decoded");
  assert.ok(!/Thank you for your cooperation|INSTRUCTIONS TO IN-PERSON SPEAKERS/.test(agenda.agendaText), "speaker instructions are left out");
  const none = sources.parseAgendaHtml("<html><body>Sorry, but this agenda is not available at this time.</body></html>");
  assert.deepEqual([none.agendaText, none.items, none.packetUrl], ["", [], null]);
  const minutes = sources.parseMinutesHtml(fixture("destiny-minutes-1137.html")).text;
  assert.match(minutes, /^MINUTES\nORO VALLEY TOWN COUNCIL\nREGULAR SESSION\nOCTOBER 7, 2026/, "minutes start with the title block");
  assert.match(minutes, /\n\nROLL CALL\n/, "headings stand on their own lines");
  assert.match(minutes, /\n1\. Pursuant to A\.R\.S\. §38-431\.03/, "item numbers join their text");
  assert.match(minutes, /Motion by Mayor Joseph C\. Winfield, seconded by Councilmember Harry Greene/);
  assert.match(minutes, /Vote: 7 - 0 Carried/);
  assert.match(minutes, /A\. Minutes - September 16, 2026/, "a nested cell does not double the item letter");
  assert.match(minutes, /Town Clerk$/, "ends with the certification");
  assert.ok(!/Print Minutes|GO TO|AgendaQuick|Search Minutes/.test(minutes), "page chrome is left out");
  assert.equal(sources.parseMinutesHtml("<html><body>An error occurred.</body></html>").text, "");
  console.log("ok  destiny agenda and minutes");

  // Draft conversion
  const draft = toDraft(LISTING[1]);
  assert.equal(draft.id, "swagit-404722");
  assert.equal(draft.title, "Regular Session");
  assert.equal(draft.overview, "", "summaries start empty; Claude or the reviewer writes them");
  assert.equal(draft.durationMinutes, 58);
  assert.equal(draft.recordingUrl, "https://orovalleyaz.new.swagit.com/videos/404722");
  assert.deepEqual(
    [draft.source.clipId, draft.source.agendaSeq, draft.source.minutesSeq, draft.source.body],
    [404722, 1136, 1140, "Town Council"]
  );
  assert.ok(draft.source.minutesUrl && draft.source.agendaUrl);
  assert.equal(toDraft(LISTING[3]).title, "Planning & Zoning Commission Meeting");
  assert.equal(meetingKind({ kind: "special" }), "Special Session");
  assert.equal(meetingKind({ kind: "work-session" }), "Study Session");
  assert.equal(meetingKind({ kind: "board", body: "Water Utility Commission" }), "Water Utility Commission Meeting");
  console.log("ok  draft conversion");

  // Review flags
  const codes = (c) => reviewFlags(c, LISTING).map((f) => f.code);
  assert.deepEqual(codes(LISTING[2]), ["low-content"]);
  assert.deepEqual(codes(LISTING[3]), ["not-council"]);
  assert.deepEqual(codes(LISTING[1]), ["same-date"]);
  assert.deepEqual(codes(LISTING[0]), ["same-date"]);
  assert.deepEqual(codes(clip(404800, "Town Council Regular Session", null, 300)), ["short", "no-date"]);
  assert.deepEqual(codes(clip(404801, "Town Council Regular Session", "2026-11-04", null)), [], "an unknown length is not 'short'");
  console.log("ok  review flags");

  // Records are keyed by Swagit video number
  assert.equal(clipIdFromUrl("https://orovalleyaz.new.swagit.com/videos/403338"), 403338);
  assert.equal(clipIdFromUrl("https://orovalleyaz.new.swagit.com/play/403338/120"), 403338);
  assert.equal(clipIdFromUrl("https://orovalleyaz.new.swagit.com/videos/403338/embed"), 403338);
  assert.equal(clipIdFromUrl("https://eloyaz.granicus.com/player/clip/288?view_id=1"), null, "other sites are ignored");
  assert.equal(clipIdFromUrl("not a url"), null);
  const keyed = { id: "swagit-404722", date: "2026-10-21", title: "Regular Session", overview: "x", details: "", durationMinutes: 58, recordingUrl: "https://orovalleyaz.new.swagit.com/videos/404722" };
  assert.equal(normalizeRecord(keyed), keyed, "a record already keyed by its video is returned as-is");
  const linked = { ...keyed, id: "some-other-id" };
  assert.equal(normalizeRecord(linked).id, "swagit-404722", "a record is keyed by the video in its link");
  const foreign = { id: "abc", date: "2026-01-05", title: "Regular Session", overview: "x", details: "", durationMinutes: null, recordingUrl: "https://archive.org/x.mp4" };
  assert.equal(normalizeRecord(foreign), foreign, "records without a Swagit link are left alone");
  console.log("ok  record ids");

  // First computer: load, write, approve, publish
  const a = new ReviewStore(tempDir());
  const firstRun = await refresh(a);
  assert.equal(firstRun.added, 4);
  assert.equal(byId(a, M2).status, "hidden", "test recordings are hidden automatically");
  assert.equal(byId(a, M1).status, "review");
  assert.equal(byId(a, M1).clipId, 404722);
  assert.equal(byId(a, M1).source.minutesSeq, 1140, "the source keeps the Destiny numbers for the dashboard");
  assert.throws(() => a.setStatus(M1, "approved"), /overview/, "an empty summary can't be approved");
  assert.equal((await refresh(a)).added, 0, "a second refresh adds nothing");

  a.update(M1, { overview: "The Council approved the consent agenda.", details: "### What the Council decided\n- Routine items (approved 7-0)." });
  a.setStatus(M1, "approved");
  assert.equal(byId(a, M1).pending, "add");
  assert.equal(a.view().pendingCount, 1);
  await a.publish(SETTINGS);
  assert.equal(published().meetings.length, 1);
  assert.deepEqual(Object.keys(published().meetings[0]).sort(), [
    "date", "details", "durationMinutes", "id", "overview", "recordingUrl", "title",
  ]);
  assert.equal(published().meetings[0].id, "swagit-404722");
  assert.equal(a.view().pendingCount, 0);
  console.log("ok  approve and publish");

  // Edits and hiding show as pending changes
  a.update(M1, { overview: "Edited overview." });
  assert.equal(byId(a, M1).pending, "update");
  a.setStatus(M1, "hidden");
  assert.equal(byId(a, M1).pending, "remove");
  a.setStatus(M1, "approved");
  await a.publish(SETTINGS);
  assert.equal(published().meetings[0].overview, "Edited overview.");
  console.log("ok  edit, hide, republish");

  // Second computer picks up what is published, then publishes a change
  const b = new ReviewStore(tempDir());
  await refresh(b);
  assert.equal(byId(b, M1).status, "approved");
  assert.equal(byId(b, M1).draft.overview, "Edited overview.");
  assert.equal(b.view().pendingCount, 0);
  b.update(M4, { overview: "Part two." });
  b.setStatus(M4, "approved");
  await b.publish(SETTINGS);
  assert.equal(published().meetings.length, 2);

  // The first computer must not overwrite that without refreshing first
  a.update(M1, { overview: "Stale edit." });
  await assert.rejects(a.publish(SETTINGS), (e) => e instanceof PublishError && /another computer/.test(e.message));
  await refresh(a);
  assert.equal(byId(a, M4).status, "approved", "adopts the other computer's approval");
  assert.equal(byId(a, M1).draft.overview, "Stale edit.", "keeps its own unpublished edit");
  await a.publish(SETTINGS);
  assert.equal(published().meetings.length, 2);
  console.log("ok  two computers stay in step");

  // Both computers edit the same meeting: the second to publish must choose
  await refresh(b);
  b.update(M1, { overview: "B's version." });
  a.update(M1, { overview: "A's version." });
  await b.publish(SETTINGS);
  await refresh(a);
  assert.equal(byId(a, M1).conflict.website.overview, "B's version.");
  assert.equal(byId(a, M1).draft.overview, "A's version.", "a conflict never discards local edits");
  await assert.rejects(a.publish(SETTINGS), (e) => e instanceof PublishError && /different version/.test(e.message));
  a.resolveConflict(M1, "website");
  assert.equal(byId(a, M1).draft.overview, "B's version.");
  assert.equal(byId(a, M1).pending, null);

  a.update(M1, { overview: "A again." });
  b.setStatus(M1, "hidden");
  await b.publish(SETTINGS);
  await refresh(a);
  assert.equal(byId(a, M1).conflict.website, null, "the other computer removed it");
  a.resolveConflict(M1, "mine");
  await a.publish(SETTINGS);
  assert.equal(published().meetings.find((m) => m.id === M1).overview, "A again.");
  console.log("ok  conflicting edits are caught");

  // Guard rails
  assert.throws(() => a.update(M1, { overview: " " }), /needs an overview/);
  assert.throws(() => a.update(M1, { date: "Oct 21" }), /date/);
  a.update(M3, { overview: "The Commission met.", date: "" });
  assert.throws(() => a.setStatus(M3, "approved"), /date/, "a meeting without a date can't be approved");
  a.update(M3, { date: "2026-10-06" });
  a.setStatus(M3, "approved");
  const wrongBranch = await refresh(new ReviewStore(tempDir()), { ...SETTINGS, githubBranch: "nope" });
  assert.match(wrongBranch.publishError, /can't find branch "nope"/);
  await assert.rejects(new ReviewStore(tempDir()).publish(SETTINGS), /Check for new meetings first/);
  const corruptDir = tempDir();
  fs.writeFileSync(path.join(corruptDir, "review-state.json"), "{not json");
  new ReviewStore(corruptDir);
  assert.ok(fs.readdirSync(corruptDir).some((f) => f.startsWith("review-state.json.corrupt-")), "damaged state is kept");
  console.log("ok  guard rails");

  // A published file keyed some other way is matched to its video by the link
  seedGithub({ version: 1, updated: "2026-10-08T22:33:19.885Z", meetings: [linked, foreign] });
  const c = new ReviewStore(tempDir());
  await refresh(c);
  assert.equal(byId(c, "some-other-id"), undefined, "the foreign id is gone");
  const migrated = byId(c, M1);
  assert.equal(migrated.status, "approved");
  assert.equal(migrated.draft.overview, "x");
  assert.equal(migrated.pending, null, "nothing to publish until something changes");
  assert.equal(migrated.source.clipId, 404722, "picks up the listing details");
  assert.equal(byId(c, "abc").status, "approved", "a record with no Swagit link is kept as-is");
  assert.equal(c.view().meetings.length, 5, "4 recordings + 1 foreign record, no duplicates");
  console.log("ok  published records match the listing");

  // Transcripts: Deepgram formatting, files, keyterms
  const { formatTranscript, buildUrl, loadKeyterms } = require("./main/engine/transcribe");
  const sample = JSON.parse(fixture("deepgram-sample.json"));
  const text = formatTranscript(sample);
  assert.ok(text.startsWith("[00:00:01] Speaker 1: I'll call the meeting to order"), "first turn is timestamped and labelled");
  assert.match(text, /\[01:01:05\] Speaker 1: All in favor\?/, "hour-long timestamps format as HH:MM:SS");
  assert.match(formatTranscript(sample, { offsetSec: 3599 }), /\[01:00:00\] Speaker 1/, "part offsets shift timestamps");
  const terms = loadKeyterms(path.join(__dirname, "resources"));
  assert.ok(terms.length > 0 && terms.length <= 50, `loads ${terms.length} keyterms`);
  assert.match(buildUrl(terms), /model=nova-3/);
  assert.match(buildUrl(terms), /&keyterm=/);
  const transcripts = require("./main/engine/transcripts");
  const tmpOut = tempDir();
  const tdir = transcripts.transcriptsDir(tmpOut);
  const clip403338 = {
    clipId: 403338, title: "Town Council Regular Session", date: "2026-10-07", time: "5:00 PM", durationSec: 5340,
    playerUrl: "https://orovalleyaz.new.swagit.com/videos/403338",
  };
  assert.equal(
    transcripts.transcriptStem(clip403338),
    "October 7 2026 Town Council Regular Session Transcript (video 403338)"
  );
  assert.equal(transcripts.meetingLabel("Town Council Special Session"), "Town Council Special Session");
  assert.equal(transcripts.meetingLabel("Town Council Study Session"), "Town Council Study Session");
  assert.equal(transcripts.meetingLabel("Planning & Zoning Commission"), "Planning and Zoning Commission Meeting");
  assert.equal(transcripts.meetingLabel("Water Utility Commission"), "Water Utility Commission Meeting");
  assert.equal(transcripts.meetingLabel("Board of Adjustment Special Session"), "Board of Adjustment Special Session");
  const savedT = transcripts.saveTranscript(tdir, clip403338, text, {
    raws: [{ offsetSec: 0, response: sample }],
    meta: { source: "automatic transcription", speakers: 4, seconds: 5366 },
  });
  assert.match(fs.readFileSync(savedT.txtPath, "utf-8"), /^Transcript: Town Council Regular Session\nDate: 2026-10-07 5:00 PM\nSwagit video: 403338  https:\/\/orovalleyaz\.new\.swagit\.com\/videos\/403338\n/);
  assert.equal(transcripts.findTranscript(tdir, 403338), savedT.txtPath, "finds the saved transcript by video number");
  assert.equal(transcripts.findTranscript(tdir, 404722), null);
  assert.equal(transcripts.readTranscriptBody(savedT.txtPath), text.trim(), "reads back the body without the header");
  assert.ok(fs.existsSync(savedT.jsonPath) && savedT.jsonPath.endsWith("video-403338.deepgram.json"), "keeps the raw Deepgram JSON");
  assert.equal(transcripts.indexTranscripts(tdir).get(403338), savedT.txtPath);
  fs.rmSync(tmpOut, { recursive: true, force: true });
  console.log("ok  transcripts");

  // Summary prompt and key checks (no network)
  const { buildUserPrompt, writeSummary } = require("./main/engine/summarize");
  const { summarizeClip, obtainAgenda } = require("./main/engine/pipeline");
  const roster = { text: "Mayor Joseph C. \"Joe\" Winfield", source: "built-in list" };
  const prompt = buildUserPrompt({
    clip: LISTING[1],
    draft: { date: "2026-10-21", overview: "Current.", details: "" },
    transcript: "[00:00:01] Speaker 1: Hello.",
    agendaText: "CONSENT AGENDA",
    roster,
  });
  for (const tag of ["<council_roster", "<posted_agenda>", "<current_summary>", "<transcript>"]) assert.ok(prompt.includes(tag), tag);
  assert.ok(buildUserPrompt({ clip: LISTING[1], draft: {}, transcript: "x", agendaText: "", roster }).includes("no current summary"));
  await assert.rejects(
    writeSummary({ clip: LISTING[1], draft: {}, transcript: "x", agendaText: "", roster }, { apiKey: "" }),
    (e) => e.needsKey && e.keyKind === "anthropic"
  );
  const dirs = { output: tempDir(), temp: os.tmpdir(), reference: path.join(__dirname, "resources") };
  await assert.rejects(
    summarizeClip({ clip: LISTING[1], keys: { deepgram: "x" }, dirs }),
    (e) => e.needsKey && e.keyKind === "anthropic",
    "the Anthropic key is checked before any transcription is paid for"
  );
  assert.equal(await obtainAgenda({ clip: { clipId: 1, agendaSeq: null, agendaUrl: null }, report() {} }), "", "no agenda number: no request");
  console.log("ok  summary prompt");

  // ffmpeg
  const { ffmpegPath } = require("./main/engine/media");
  const ff = spawnSync(ffmpegPath(), ["-hide_banner", "-encoders"], { encoding: "utf-8" });
  assert.equal(ff.status, 0, "ffmpeg runs");
  assert.match(ff.stdout, /libmp3lame/, "ffmpeg can encode MP3");
  console.log(`ok  ffmpeg (${ffmpegPath()})`);

  // Council roster from the Town's Mayor and Council page (offline sample of its markup)
  const { parseRosterHtml, buildRosterText, rosterLines, FALLBACK_ROSTER } = require("./main/engine/roster");
  const entries = parseRosterHtml(`<nav><a href="/Government/Mayor-and-Council">Mayor and Council</a></nav>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Mayor">Mayor Winfield</a></strong><br />Email: x</p>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Vice-Mayor?BestBetMatch=x">Vice Mayor Barrett</a></strong></p>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Harry-%E2%80%9CMo%E2%80%9D-Greene-II-MD?x=1">Councilmember Greene</a></strong></p>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Joyce-Jones-Ivey">Councilmember Jones-Ivey</a></strong></p>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Josh-Nicolson">Councilmember Nicolson</a></strong></p>
    <p><strong><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Mary-Murphy">Councilmember Murphy</a></strong></p>
    <p><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Rosa-Dailey"><strong>Councilmember Dailey</strong></a></p>
    <p><a href="https://www.orovalleyaz.gov/Government/Departments/Mayor-and-Council/Mary-Murphy">Councilmember Murphy</a> (duplicate)</p>
    <h2>Request a Visit from a Town Councilmember</h2>`);
  assert.equal(entries.length, 7, "one entry per member, duplicates and menu links ignored");
  assert.deepEqual(entries[0], { title: "Mayor", lastName: "Winfield", slugName: "" });
  assert.deepEqual(entries[2], { title: "Councilmember", lastName: "Greene", slugName: 'Harry "Mo" Greene II MD' });
  const rosterText = buildRosterText(entries);
  assert.match(rosterText, /^Mayor Joseph C\. "Joe" Winfield\nVice Mayor Melanie Barrett\nCouncilmember Harry "Mo" Greene II\n/, "full names come from the built-in list");
  assert.match(rosterText, /\nCouncilmember Rosa Dailey\n/, "a member not in the built-in list is named from their page address");
  assert.match(rosterText, /\nTown Clerk Mike \(Michael\) Standish\nTown Manager Jeff Wilkins\nTown Attorney Steven Zraick$/, "staff come from the built-in list");
  assert.deepEqual(rosterLines("Mayor Joseph C. \"Joe\" Winfield\nTown Attorney Steven Zraick\nSomeone Else"), [
    { title: "Mayor", name: 'Joseph C. "Joe" Winfield' },
    { title: "Town Attorney", name: "Steven Zraick" },
    { title: "", name: "Someone Else" },
  ]);
  assert.equal(rosterLines(FALLBACK_ROSTER).length, 10);
  assert.deepEqual(parseRosterHtml("<p>Page moved</p>"), [], "unrecognized page -> built-in list");
  console.log("ok  council roster");

  // Optional live checks
  if (process.env.SMOKE_LIVE === "1") {
    global.fetch = realFetch;
    const live = await sources.listMeetings({ monthsBack: 1 });
    assert.ok(live.length >= 3, `live listing has ${live.length} meetings with video this month and last`);
    assert.ok(live.every((m) => m.clipId && m.date && m.title), "every live row has a video, date and title");
    console.log(`    newest recording: ${live[0].date} ${live[0].title} (video ${live[0].clipId})`);
    const resolved = await sources.resolveClip(339060);
    assert.equal(resolved.hlsUrl, v.hlsUrl, "resolves the HLS stream from the live video page");
    assert.equal(resolved.mp4Url, "https://orovalleyaz.new.swagit.com/videos/339060/download");
    assert.deepEqual([resolved.date, resolved.title, resolved.agendaSeq], ["2025-04-02", "Town Council Regular Session", 1007]);
    // The April 2, 2025 meeting (executive session at 5 PM, regular session at 6 PM) runs about 3h 40m.
    assert.ok(resolved.durationSec > 3 * 3600 && resolved.durationSec < 4.5 * 3600, `stream length ${resolved.durationLabel}`);
    assert.ok(resolved.index.length >= 20, `live index has ${resolved.index.length} chapters`);
    console.log(`    video 339060: ${resolved.durationLabel}, ${resolved.index.length} chapters, agenda ${resolved.agendaSeq}`);
    const resp = await fetch(resolved.hlsUrl, { headers: sources.MEDIA_HEADERS });
    assert.ok(resp.ok && (await resp.text()).startsWith("#EXTM3U"), "the stream is served with a browser User-Agent");
    const liveAgenda = await sources.fetchAgenda(resolved);
    assert.ok(liveAgenda.agendaText.length > 500 && liveAgenda.date === "2025-04-02", "live agenda text is readable");
    const liveMinutes = await sources.fetchPublishedMinutes(1137);
    assert.match(liveMinutes.text, /^MINUTES\nORO VALLEY TOWN COUNCIL/, "live published minutes are readable");
    assert.equal((await sources.fetchPublishedMinutes(999999)).text, "", "a missing minutes number gives no text");
    const { loadCouncilRoster, ROSTER_URL } = require("./main/engine/roster");
    const liveRoster = await loadCouncilRoster();
    assert.equal(liveRoster.source, ROSTER_URL, "roster read from orovalleyaz.gov");
    assert.match(liveRoster.text, /^Mayor /);
    console.log(`    roster: ${liveRoster.text.split("\n").length} lines from ${liveRoster.source}`);
    console.log("ok  live Swagit, Destiny and roster");
  }

  console.log(`\nSMOKE TEST PASSED (${github.puts.length} publishes: ${github.puts.join(" | ")})`);
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});

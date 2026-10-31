/* Search engine test: no Electron, API keys, or network needed.
 * Builds a temp corpus (three transcripts in the real file format, one minutes
 * draft, summaries), then checks parsing, query syntax, search, topics,
 * passage retrieval, the ask prompt, the job queue, and search speed over a
 * hundred long transcripts.
 * Run: node search-test.js
 */
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const transcripts = require("./main/engine/transcripts");
const minutesStore = require("./main/engine/minutesStore");
const { Corpus, parseTurns } = require("./main/engine/corpus");
const search = require("./main/engine/search");
const topics = require("./main/engine/topics");
const ask = require("./main/engine/ask");
const { JobQueue } = require("./main/engine/jobs");

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ov-search-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Fixtures ---------------------------------------------------------------

function clip(clipId, title, date, durationSec) {
  return { clipId, title, date, durationSec, playerUrl: `https://orovalleyaz.new.swagit.com/videos/${clipId}` };
}

const CLIPS = [
  clip(401001, "Town Council Regular Session", "2026-08-05", 5400),
  clip(401002, "Planning and Zoning Commission", "2026-09-02", 3600),
  clip(401003, "Town Council Study Session", "2026-10-07", 7200),
];

const BODY_1 = [
  "[00:00:01] Speaker 1: I'll call the meeting to order. Good evening, everyone.",
  "[00:00:12] Speaker 2: The first item is the Naranja Park expansion budget. Staff recommend approving the contract.",
  "[00:05:30] Speaker 3: I have concerns about the park's parking lot and the golf course drainage.",
  "[00:09:00] Speaker 1: Motion to approve the Naranja Park contract for two million dollars.",
  "[00:09:30] Speaker 2: Second.",
  "[00:09:45] Speaker 1: All in favor? Motion carries seven to zero.",
].join("\n\n");

const LONG_TURN =
  "The water utility rate study looked at every customer class. " +
  "Residents on the east side asked about the reclaimed water line, and the consultant explained the phasing of the capital projects over five years. "
    .repeat(3) +
  "Staff will bring the water rate ordinance back in November, and the Council asked for a comparison with Marana and Tucson Water rates before then.";

const BODY_2 = [
  "[00:00:05] Speaker 1: Planning and Zoning Commission, call to order.",
  "[00:03:10] Speaker 2: The rezoning request on Oracle Road near the golf course drew several neighbours.",
  `[00:20:00] Speaker 3: ${LONG_TURN}`,
  "--- Part 2 of 2 (starts at 01:00:00; speaker numbers restart in each part) ---",
  "[01:00:10] Speaker 1: Resuming. Next is the parks master plan update.",
].join("\n\n");

const BODY_3 = [
  "[00:00:02] Speaker 1: Study session on the budget. No votes tonight.",
  "[00:15:00] Speaker 2: The golf courses lost money again this year; the general fund transfer was 1.2 million.",
  "[00:30:00] Speaker 3: Naranja Park phase two and the aquatic center are in the capital plan.",
  "[00:45:00] Speaker 2: We also discussed the water rates with the utility commission.",
].join("\n\n");

function meeting(c, overview, details) {
  return {
    id: `swagit-${c.clipId}`,
    clipId: c.clipId,
    status: "review",
    draft: { id: `swagit-${c.clipId}`, date: c.date, title: c.title, overview, details },
    source: {
      clipId: c.clipId,
      title: c.title,
      body: /planning/i.test(c.title) ? "Planning and Zoning Commission" : "Town Council",
      kind: /planning/i.test(c.title) ? "planning" : "council",
      playerUrl: c.playerUrl,
      durationSec: c.durationSec,
    },
  };
}

function buildFixtures(root) {
  const tDir = transcripts.transcriptsDir(root);
  const mDir = minutesStore.minutesDir(root);
  transcripts.saveTranscript(tDir, CLIPS[0], BODY_1, { meta: { source: "test", seconds: 5400, speakers: 3 } });
  transcripts.saveTranscript(tDir, CLIPS[1], BODY_2, { meta: { source: "test", seconds: 3600, speakers: 3, parts: 2 } });
  transcripts.saveTranscript(tDir, CLIPS[2], BODY_3, { meta: { source: "test", seconds: 7200, speakers: 3 } });
  minutesStore.saveMinutes(
    mDir,
    CLIPS[0],
    "# MINUTES\nORO VALLEY TOWN COUNCIL\n\n## REGULAR AGENDA\n\n1. Naranja Park expansion contract\n\nMotion by Mayor Joseph C. Winfield, seconded by Vice-Mayor Melanie Barrett to approve the contract.\nVote: 7 - 0 Carried",
    { notes: ["[00:09:00] Check the contract amount."] }
  );
  const meetings = [
    meeting(CLIPS[0], "The Council approved a park expansion contract.", "### What the Council decided\n- Approved the Naranja Park contract (approved 7-0)."),
    meeting(CLIPS[1], "", ""),
    meeting(CLIPS[2], "The Council reviewed the budget, including golf and water rates.", ""),
    // A meeting without any files yet.
    { id: "swagit-401004", clipId: 401004, status: "review", draft: { date: "2026-10-21", title: "Town Council Regular Session" }, source: { body: "Town Council", kind: "council" } },
  ];
  return { tDir, mDir, meetings };
}

// ---- Tests -----------------------------------------------------------------

async function main() {
  const root = tempDir();
  const { tDir, mDir, meetings } = buildFixtures(root);

  // parseTurns
  const turns = parseTurns(transcripts.readTranscriptBody(transcripts.findTranscript(tDir, 401002)));
  assert.equal(turns.length, 4, "part markers are skipped, turns are kept");
  assert.deepEqual([turns[0].i, turns[0].sec, turns[0].time, turns[0].speaker], [0, 5, "00:00:05", "Speaker 1"]);
  assert.deepEqual([turns[3].sec, turns[3].time], [3610, "01:00:10"], "hour-long times keep the hour");
  assert.equal(turns[2].text, LONG_TURN.replace(/\s+/g, " ").trim());
  const captions = parseTurns("[00:00:01] Hello there\n[00:00:04] Second line\nwrapped\n\nNo timestamp at all");
  assert.deepEqual(
    captions.map((t) => [t.sec, t.speaker, t.text]),
    [
      [1, null, "Hello there"],
      [4, null, "Second line wrapped"],
      [null, null, "No timestamp at all"],
    ],
    "captions variant and flat text"
  );
  console.log("ok  parseTurns");

  // corpus
  const corpus = new Corpus({ transcriptsDir: tDir, minutesDir: mDir });
  const counts = corpus.refresh(meetings);
  assert.deepEqual(counts, { meetings: 4, transcripts: 3, minutesDrafts: 1, summaries: 2, turns: 14 });
  const d1 = corpus.get("swagit-401001");
  assert.ok(d1.hasTranscript && d1.hasSummary && d1.hasMinutes);
  assert.equal(d1.transcript.turns.length, 6);
  assert.match(d1.minutes.text, /^# MINUTES/);
  assert.ok(!d1.minutes.text.includes("oro-valley-minutes-draft"), "minutes metadata comment is stripped");
  assert.equal(d1.summary.text, "The Council approved a park expansion contract.\n\n### What the Council decided\n- Approved the Naranja Park contract (approved 7-0).");
  assert.equal(corpus.get("swagit-401004").transcript, null);
  assert.deepEqual(corpus.docs.map((d) => d.meetingId), ["swagit-401004", "swagit-401003", "swagit-401002", "swagit-401001"], "newest first");
  const stats = corpus.stats();
  assert.deepEqual([stats.earliest, stats.latest, stats.transcriptHours], ["2026-08-05", "2026-10-07", 4.5]);
  // Cache: a second refresh re-reads nothing; a changed file is re-read.
  const before = corpus.section("swagit-401001", "transcript");
  corpus.refresh(meetings);
  assert.equal(corpus.section("swagit-401001", "transcript"), before, "unchanged file keeps its index");
  const p1 = transcripts.findTranscript(tDir, 401001);
  fs.appendFileSync(p1, "\n\n[01:20:00] Speaker 1: Meeting adjourned.\n");
  assert.equal(corpus.refresh(meetings).turns, 15, "changed file is re-read");
  assert.notEqual(corpus.section("swagit-401001", "transcript"), before);
  console.log("ok  corpus refresh, docs, stats, cache");

  // parseQuery
  const q = search.parseQuery('Naranja "golf course" -drainage park* a "x"');
  assert.deepEqual(q.terms, ["naranja", "park*"]);
  assert.deepEqual(q.phrases, ["golf course"]);
  assert.deepEqual(q.excluded, ["drainage"]);
  assert.equal(q.raw, 'Naranja "golf course" -drainage park* a "x"');
  assert.deepEqual(search.parseQuery("“parks master” plan,").phrases, ["parks master"], "smart quotes and trailing punctuation");
  assert.deepEqual(search.parseQuery('-"golf course" water').excluded, ["golf course"], "excluded phrase");
  console.log("ok  parseQuery");

  // highlightRanges and plural/possessive/wildcard matching
  const text = "The park, the parks, the park's lot and the parking garage.";
  const pr = search.highlightRanges(text, search.parseQuery("park"));
  assert.deepEqual(pr.map(([s, e]) => text.slice(s, e)), ["park", "parks", "park's"], "plural and possessive, not 'parking'");
  const wr = search.highlightRanges(text, search.parseQuery("park*"));
  assert.deepEqual(wr.map(([s, e]) => text.slice(s, e)), ["park", "parks", "park's", "parking"], "wildcard prefix");
  assert.equal(search.countMatches(text, search.parseQuery("park")), 3);
  assert.deepEqual(search.highlightRanges("Golf   course and golf course's", search.parseQuery('"golf course"')).length, 2, "phrase with flexible spacing");
  console.log("ok  highlightRanges, countMatches");

  // search: AND semantics
  let r = search.search(corpus, "naranja golf");
  assert.equal(r.total, 2, "AND: both terms must appear in the meeting (401001 transcript+minutes, 401003)");
  assert.deepEqual(r.meetings.map((m) => m.meetingId).sort(), ["swagit-401001", "swagit-401003"]);
  r = search.search(corpus, "naranja");
  assert.equal(r.total, 2);
  assert.equal(r.meetings[0].meetingId, "swagit-401001", "relevance: most hits first");
  assert.ok(r.meetings[0].hits >= 4, `hits across transcript, summary and minutes (${r.meetings[0].hits})`);
  assert.ok(r.hits >= r.meetings[0].hits + 1);
  assert.equal(r.meetings[0].playerUrl, CLIPS[0].playerUrl);
  // phrase
  r = search.search(corpus, '"golf course"');
  assert.deepEqual(r.meetings.map((m) => m.meetingId).sort(), ["swagit-401001", "swagit-401002", "swagit-401003"], "phrase, plural golf courses too");
  r = search.search(corpus, '"park contract"');
  assert.deepEqual(r.meetings.map((m) => m.meetingId), ["swagit-401001"]);
  assert.equal(search.search(corpus, '"contract park"').total, 0, "phrase order matters");
  // exclusion
  r = search.search(corpus, "golf -drainage");
  assert.deepEqual(r.meetings.map((m) => m.meetingId).sort(), ["swagit-401002", "swagit-401003"], "-drainage drops the meeting that mentions it");
  // kinds filter
  r = search.search(corpus, "naranja", { kinds: ["summary"] });
  assert.deepEqual(r.meetings.map((m) => m.meetingId), ["swagit-401001"]);
  assert.ok(r.meetings[0].snippets.every((s) => s.kind === "summary" && s.sec === null));
  r = search.search(corpus, "winfield", { kinds: ["transcript"] });
  assert.equal(r.total, 0, "the name is only in the minutes");
  r = search.search(corpus, "winfield", { kinds: ["minutes"] });
  assert.equal(r.total, 1);
  assert.equal(r.meetings[0].snippets[0].kind, "minutes");
  assert.ok(!r.meetings[0].snippets[0].text.startsWith("- "), "markdown markers stripped from paragraphs");
  // date filter and bodies
  r = search.search(corpus, "golf", { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(r.meetings.map((m) => m.meetingId), ["swagit-401002"]);
  r = search.search(corpus, "golf", { from: "2026-10-01" });
  assert.deepEqual(r.meetings.map((m) => m.meetingId), ["swagit-401003"]);
  r = search.search(corpus, "golf", { bodies: ["Planning and Zoning Commission"] });
  assert.deepEqual(r.meetings.map((m) => m.meetingId), ["swagit-401002"]);
  r = search.search(corpus, "golf", { sort: "date" });
  assert.deepEqual(r.meetings.map((m) => m.date), ["2026-10-07", "2026-09-02", "2026-08-05"]);
  assert.equal(search.search(corpus, "golf", { limit: 1 }).meetings.length, 1);
  assert.equal(search.search(corpus, "golf", { limit: 1 }).total, 3, "total counts every match, limit cuts the list");
  assert.equal(search.search(corpus, "").total, 0);
  assert.equal(search.search(corpus, "a").total, 0, "one-letter terms are ignored");
  console.log("ok  search: AND, phrase, exclusion, kinds, dates, bodies, sort");

  // snippets: ranges and truncation
  r = search.search(corpus, "naranja", { kinds: ["transcript"], snippetLimit: 1 });
  const snip = r.meetings[0].snippets[0];
  assert.deepEqual([snip.kind, snip.sec, snip.time, snip.speaker, snip.index], ["transcript", 12, "00:00:12", "Speaker 2", 1]);
  assert.equal(snip.text.slice(snip.ranges[0][0], snip.ranges[0][1]), "Naranja", "range slices to the term");
  r = search.search(corpus, "tucson", { kinds: ["transcript"] });
  const long = r.meetings[0].snippets[0];
  assert.ok(long.text.length <= 330 && long.text.startsWith("…"), `long turn truncated to ${long.text.length} chars with a leading ellipsis`);
  assert.equal(long.text.slice(long.ranges[0][0], long.ranges[0][1]).toLowerCase(), "tucson", "ranges follow the truncated text");
  assert.equal(long.index, 2);
  r = search.search(corpus, "water", { kinds: ["transcript"], meetingIds: ["swagit-401002"] });
  const multi = r.meetings[0].snippets[0];
  assert.ok(multi.ranges.length >= 2 && multi.text.endsWith("…"), "several ranges, trailing ellipsis");
  for (const [s, e] of multi.ranges) assert.equal(multi.text.slice(s, e).toLowerCase(), "water");
  assert.equal(r.meetings[0].hits, 1, "one matching turn counts once however many times the word appears");
  assert.equal(search.search(corpus, "golf", { snippetLimit: 0 }).meetings[0].snippets.length, 0);
  console.log("ok  snippets: truncation and ranges");

  // speakerStats
  const sp = search.speakerStats(corpus, "swagit-401001");
  assert.equal(sp.length, 3);
  assert.deepEqual([sp[0].speaker, sp[0].turns], ["Speaker 1", 4], "four turns beat one turn followed by a long silence (silences are capped)");
  assert.ok(sp.find((s) => s.speaker === "Speaker 3").seconds < 60, "a 13-word turn before a 3-minute gap is not credited with 3 minutes");
  assert.ok(sp.every((s) => s.turns > 0 && s.words > 0 && s.seconds >= 0));
  assert.ok(sp[0].seconds >= sp[1].seconds && sp[1].seconds >= sp[2].seconds, "sorted by seconds desc");
  assert.equal(sp.reduce((n, s) => n + s.turns, 0), 7);
  assert.deepEqual(search.speakerStats(corpus, "nope"), []);
  console.log("ok  speakerStats");

  // TopicStore
  const dataDir = path.join(root, "data");
  const store = new topics.TopicStore(dataDir);
  assert.deepEqual(store.list(), []);
  const parksTopic = store.add({ name: "Parks", terms: ["Naranja Park", "park*"] });
  const golfTopic = store.add({ name: "Golf", terms: '"golf course", golf' });
  const waterTopic = store.add({ name: "Water", terms: ["water"], color: "#123456" });
  assert.deepEqual([parksTopic.color, golfTopic.color, waterTopic.color], [topics.PALETTE[0], topics.PALETTE[1], "#123456"]);
  assert.deepEqual(golfTopic.terms, ['"golf course"', "golf"], "comma-separated terms accepted");
  assert.ok(fs.existsSync(path.join(dataDir, "topics.json")) && !fs.existsSync(path.join(dataDir, "topics.json.tmp")), "atomic write");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "topics.json"), "utf-8")).length, 3);
  store.update(golfTopic.id, { name: "Golf courses", terms: ["golf"] });
  assert.deepEqual(new topics.TopicStore(dataDir).get(golfTopic.id).name, "Golf courses", "reloaded from disk");
  store.remove(waterTopic.id);
  assert.equal(store.list().length, 2);
  assert.throws(() => store.remove("nope"));
  assert.throws(() => store.add({ name: "", terms: ["x"] }));
  console.log("ok  TopicStore CRUD");

  // topicStats
  const ts = topics.topicStats(corpus, store.get(parksTopic.id));
  assert.equal(ts.name, "Parks");
  assert.deepEqual(ts.meetings.map((m) => m.meetingId), ["swagit-401003", "swagit-401002", "swagit-401001"], "date desc");
  assert.equal(ts.meetingsCount, 3);
  assert.equal(ts.totalHits, ts.meetings.reduce((n, m) => n + m.hits, 0));
  const first = ts.meetings.find((m) => m.meetingId === "swagit-401001");
  assert.deepEqual([first.firstSec, first.firstTime], [12, "00:00:12"]);
  assert.deepEqual(ts.byMonth.map((b) => b.month), ["2026-08", "2026-09", "2026-10"]);
  const gs = topics.topicStats(corpus, { id: "g", name: "G", terms: ["drainage", "aquatic"] });
  assert.deepEqual(gs.byMonth.map((b) => [b.month, b.meetings]), [["2026-08", 1], ["2026-09", 0], ["2026-10", 1]], "zero month between hits");
  assert.equal(topics.topicStats(corpus, store.get(parksTopic.id), { from: "2026-10-01" }).meetingsCount, 1);
  assert.equal(topics.topicStats(corpus, { id: "n", name: "N", terms: ["nothing-here"] }).byMonth.length, 0);
  // AND inside one term: "naranja budget" needs both words in one turn
  assert.equal(topics.topicStats(corpus, { id: "a", name: "A", terms: ["naranja budget"] }).totalHits, 1);
  assert.equal(topics.topicStats(corpus, { id: "a", name: "A", terms: ["naranja drainage"] }).totalHits, 0, "words in different turns do not match");
  // topicsForMeeting and topicsOverview
  const tfm = topics.topicsForMeeting(corpus, store.list(), "swagit-401002");
  assert.deepEqual(tfm.map((t) => [t.name, t.hits]), [["Golf courses", 1], ["Parks", 1]], "hits desc, then name");
  assert.deepEqual(tfm.map((t) => t.color), [topics.PALETTE[1], topics.PALETTE[0]]);
  assert.deepEqual(topics.topicsForMeeting(corpus, store.list(), "swagit-401004"), []);
  const ov = topics.topicsOverview(corpus, store.list(), { now: new Date(2026, 9, 31) });
  assert.equal(ov.length, 2);
  assert.equal(ov[0].trend.length, 12);
  assert.deepEqual([ov[0].trend[0].month, ov[0].trend[11].month], ["2025-11", "2026-10"]);
  assert.equal(ov[0].lastDate, "2026-10-07");
  assert.equal(ov[0].trend.reduce((n, t) => n + t.hits, 0), ov[0].totalHits);
  console.log("ok  topicStats, topicsForMeeting, topicsOverview");

  // tokenize and retrievePassages
  assert.deepEqual(ask.tokenize("What did the Council decide about the parks' budgets?"), ["decide", "park", "budget"]);
  assert.ok(ask.STOP_WORDS.has("the") && !ask.STOP_WORDS.has("budget"));
  let passages = ask.retrievePassages(corpus, "How much was the Naranja Park contract?");
  assert.ok(passages.length >= 2, `passages found (${passages.length})`);
  assert.deepEqual(passages.map((p) => p.n), passages.map((_, i) => i + 1), "numbered 1..n");
  for (let i = 1; i < passages.length; i++) {
    const a = passages[i - 1];
    const b = passages[i];
    const order = String(a.date).localeCompare(String(b.date)) || (a.sec == null ? -1 : a.sec) - (b.sec == null ? -1 : b.sec);
    assert.ok(order <= 0, "ordered by date then time");
  }
  const summaries = passages.filter((p) => p.kind === "summary");
  assert.ok(summaries.length >= 1 && summaries.every((p) => p.sec === null && p.time === null), "summaries of matching meetings included");
  const contract = passages.find((p) => p.kind === "transcript" && /two million/.test(p.text));
  assert.ok(contract, "the contract turn is retrieved");
  assert.ok(contract.text.split("\n").length >= 3, `merged with its neighbours (${contract.text.split("\n").length} turns)`);
  assert.ok(contract.text.startsWith(`[${contract.time}] `), "passage time is its first turn");
  assert.equal(ask.retrievePassages(corpus, "two million dollars", { meetingIds: ["swagit-401001"] }).filter((p) => p.kind === "transcript").length, 1, "overlapping windows are merged");
  assert.ok(contract.text.length <= 1800);
  assert.ok(contract.score > 0);
  // budget
  const tight = ask.retrievePassages(corpus, "golf course money", { maxChars: 600 });
  assert.ok(tight.length >= 1 && tight.reduce((n, p) => n + p.text.length, 0) <= 600, "stays within the character budget");
  assert.equal(ask.retrievePassages(corpus, "golf", { maxPassages: 1 }).filter((p) => p.kind === "transcript").length, 1);
  assert.deepEqual(ask.retrievePassages(corpus, "the and of"), [], "only stop words");
  assert.deepEqual(ask.retrievePassages(corpus, "zebra"), []);
  assert.deepEqual(ask.retrievePassages(corpus, "golf", { meetingIds: ["swagit-401003"] }).map((p) => p.meetingId), ["swagit-401003", "swagit-401003"]);
  assert.ok(ask.retrievePassages(corpus, "golf", { to: "2026-08-31" }).every((p) => p.date === "2026-08-05"));
  console.log("ok  retrievePassages");

  // buildAskPrompt
  passages = ask.retrievePassages(corpus, "What happened with the golf course?");
  const prompt = ask.buildAskPrompt({
    question: "What happened with the golf course?",
    passages,
    roster: { text: "Mayor Joseph C. Winfield", source: "built-in list" },
    scope: { from: "2026-08-01" },
  });
  assert.match(prompt, /^Question from Town Clerk staff: What happened with the golf course\?/);
  assert.match(prompt, /limited to meetings on or after 2026-08-01/);
  assert.match(prompt, /<council_roster source="built-in list">\nMayor Joseph C. Winfield\n<\/council_roster>/);
  for (const p of passages) {
    const label = p.kind === "summary" ? 'kind="staff summary"' : `time="${p.time}"`;
    assert.ok(prompt.includes(`<passage n="${p.n}" meeting="${ask.fmtMeetingLabel(p)}" ${label}>\n${p.text}\n</passage>`), `passage ${p.n} in prompt`);
  }
  assert.ok(prompt.includes('meeting="Sep 2, 2026 Planning and Zoning Commission"'));
  assert.match(ask.SYSTEM_PROMPT, /Town Clerk/);
  assert.match(ask.SYSTEM_PROMPT, /not identities/);
  assert.equal(ask.MODEL, require("./main/engine/summarize").MODEL);
  // askQuestion guards (no network)
  await assert.rejects(ask.askQuestion({ question: "golf", corpus }, {}), (e) => e.needsKey && e.keyKind === "anthropic");
  await assert.rejects(ask.askQuestion({ question: "zebra", corpus }, { apiKey: "k" }), /No transcripts match that question yet/);
  console.log("ok  buildAskPrompt, askQuestion guards");

  // JobQueue
  const log = [];
  const runners = {
    transcript: async (id, { signal, onProgress }) => {
      log.push(`start ${id}`);
      onProgress(`working on ${id}`);
      for (let i = 0; i < 20; i++) {
        if (signal.aborted) throw new Error("aborted");
        await sleep(5);
      }
      log.push(`end ${id}`);
      return id;
    },
    summary: async (id) => {
      log.push(`summary ${id}`);
      throw new Error(`boom ${id}`);
    },
    minutes: async () => "ok",
  };
  const queue = new JobQueue({ runners });
  const changes = [];
  const off = queue.onChange((s) => changes.push(s));
  assert.deepEqual(queue.enqueue([{ meetingId: "m1", kind: "transcript" }, { meetingId: "m2", kind: "summary" }, { meetingId: "m1", kind: "transcript" }, { meetingId: "m3", kind: "bogus" }]), { added: 2, skipped: 2 });
  assert.deepEqual(queue.status().pending.map((j) => j.meetingId), ["m1", "m2"]);
  assert.equal(queue.status().running, null, "runner starts after enqueue returns");
  await sleep(30);
  assert.deepEqual([queue.status().running.meetingId, queue.status().running.progress], ["m1", "working on m1"]);
  assert.deepEqual(queue.enqueue([{ meetingId: "m1", kind: "transcript" }]), { added: 0, skipped: 1 }, "the running job is not queued twice");
  assert.deepEqual(queue.enqueue([{ meetingId: "m3", kind: "transcript" }]), { added: 1, skipped: 0 });
  await queue.idle();
  assert.deepEqual(log, ["start m1", "end m1", "summary m2", "start m3", "end m3"], "one at a time, in order, failures do not stop the queue");
  const done = queue.status().done;
  assert.deepEqual(done.map((d) => [d.meetingId, d.ok, d.error]), [["m1", true, null], ["m2", false, "boom m2"], ["m3", true, null]]);
  assert.ok(done.every((d) => d.finishedAt));
  assert.ok(changes.length >= 6 && changes.every((s) => "running" in s && "pending" in s && "done" in s));
  // cancelAll aborts the running job and clears pending
  queue.enqueue([{ meetingId: "c1", kind: "transcript" }, { meetingId: "c2", kind: "transcript" }, { meetingId: "c3", kind: "transcript" }]);
  await sleep(20);
  assert.equal(queue.status().running.meetingId, "c1");
  queue.cancelAll();
  await queue.idle();
  const after = queue.status();
  assert.equal(after.running, null);
  assert.deepEqual(after.pending, []);
  const c1 = after.done.find((d) => d.meetingId === "c1");
  assert.deepEqual([c1.ok, c1.error, c1.cancelled], [false, "Cancelled.", true]);
  assert.ok(!after.done.some((d) => d.meetingId === "c2"), "pending jobs were dropped, not run");
  // cancelOne removes a pending job or aborts the running one
  queue.enqueue([{ meetingId: "d1", kind: "transcript" }, { meetingId: "d2", kind: "transcript" }]);
  await sleep(20);
  assert.equal(queue.cancelOne("d2", "transcript"), true);
  assert.equal(queue.cancelOne("d2", "transcript"), false);
  assert.equal(queue.cancelOne("d1", "transcript"), true);
  await queue.idle();
  assert.equal(queue.status().done.find((d) => d.meetingId === "d1").cancelled, true);
  off();
  const n = changes.length;
  queue.enqueue([{ meetingId: "e1", kind: "minutes" }]);
  await queue.idle();
  assert.equal(changes.length, n, "unsubscribed");
  for (let i = 0; i < 60; i++) queue.enqueue([{ meetingId: `z${i}`, kind: "minutes" }]);
  await queue.idle();
  assert.equal(queue.status().done.length, 50, "done list keeps the last 50");
  console.log("ok  JobQueue: sequential, failures, cancelAll, cancelOne, onChange");

  // Performance: 100 transcripts of ~100k characters each.
  const perfRoot = tempDir();
  const perfDir = transcripts.transcriptsDir(perfRoot);
  const words = ("the council budget park water golf road resident motion approve contract staff report item public comment " +
    "zoning permit plan fire police library trail traffic signal sewer utility rate fee tax bond grant project study session " +
    "naranja oracle tangerine lambert rancho vistoso steam pump ranch canada drive development housing apartments school course").split(" ");
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const perfMeetings = [];
  for (let i = 0; i < 100; i++) {
    const lines = [];
    let sec = 0;
    let chars = 0;
    while (chars < 100000) {
      const len = 12 + Math.floor(rnd() * 40);
      const sentence = [];
      for (let w = 0; w < len; w++) sentence.push(words[Math.floor(rnd() * words.length)]);
      const line = `[${transcripts_fmt(sec)}] Speaker ${1 + Math.floor(rnd() * 6)}: ${sentence.join(" ")}.`;
      lines.push(line);
      chars += line.length + 2;
      sec += 5 + Math.floor(rnd() * 40);
    }
    const month = String(1 + (i % 12)).padStart(2, "0");
    const c = clip(500000 + i, "Town Council Regular Session", `2025-${month}-${String(1 + (i % 28)).padStart(2, "0")}`, sec);
    transcripts.saveTranscript(perfDir, c, lines.join("\n\n"));
    perfMeetings.push(meeting(c, "", ""));
  }
  const perf = new Corpus({ transcriptsDir: perfDir, minutesDir: path.join(perfRoot, "Minutes") });
  let t0 = process.hrtime.bigint();
  const perfCounts = perf.refresh(perfMeetings);
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
  t0 = process.hrtime.bigint();
  perf.refresh(perfMeetings);
  const refreshMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const chars = perf.docs.reduce((n, d) => n + perf.section(d.meetingId, "transcript").text.length, 0);
  const queries = ["budget", '"golf course"', '"public comment" -school', "naranja park* water", "nonexistentword", "zoning permit plan fire"];
  const timings = [];
  for (const text of queries) {
    search.search(perf, text); // warm the regex cache
    const runs = [];
    let res;
    for (let k = 0; k < 5; k++) {
      t0 = process.hrtime.bigint();
      res = search.search(perf, text);
      runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    runs.sort((a, b) => a - b);
    timings.push({ text, median: runs[2], max: runs[4], total: res.total, hits: res.hits });
  }
  t0 = process.hrtime.bigint();
  const perfPassages = ask.retrievePassages(perf, "What did the council decide about the water utility rate study?");
  const askMs = Number(process.hrtime.bigint() - t0) / 1e6;
  t0 = process.hrtime.bigint();
  const perfTopics = topics.topicsOverview(perf, [
    { id: "a", name: "A", terms: ["naranja park", "park*"], color: "#000" },
    { id: "b", name: "B", terms: ["golf course", "golf"], color: "#000" },
    { id: "c", name: "C", terms: ["water rate"], color: "#000" },
  ]);
  const topicsMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`    corpus: ${perfCounts.transcripts} transcripts, ${perfCounts.turns.toLocaleString()} turns, ${(chars / 1e6).toFixed(1)}M chars; first load ${loadMs.toFixed(0)} ms, refresh (unchanged) ${refreshMs.toFixed(1)} ms`);
  for (const t of timings) {
    console.log(`    search ${JSON.stringify(t.text).padEnd(30)} median ${t.median.toFixed(1).padStart(6)} ms  max ${t.max.toFixed(1).padStart(6)} ms  (${t.total} meetings, ${t.hits} hits)`);
  }
  console.log(`    retrievePassages ${askMs.toFixed(0)} ms (${perfPassages.length} passages, ${perfPassages.reduce((n, p) => n + p.text.length, 0).toLocaleString()} chars); topicsOverview x3 ${topicsMs.toFixed(0)} ms (${perfTopics.map((t) => t.totalHits).join("/")} hits)`);
  const slowest = Math.max(...timings.map((t) => t.median));
  assert.ok(slowest < 1000, `search median under 1 s (${slowest.toFixed(0)} ms)`);
  assert.ok(refreshMs < 200, `refresh of an unchanged corpus is cheap (${refreshMs.toFixed(0)} ms)`);
  assert.ok(perfPassages.reduce((n, p) => n + p.text.length, 0) <= 120000);
  console.log(`ok  performance (slowest search median ${slowest.toFixed(0)} ms${slowest > 300 ? ", above the 300 ms target" : ""})`);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(perfRoot, { recursive: true, force: true });
  console.log("\nSEARCH TEST PASSED");
}

function transcripts_fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

main().catch((e) => {
  console.error("SEARCH TEST FAILED:", e);
  process.exit(1);
});

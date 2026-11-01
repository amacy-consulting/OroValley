/* Minutes engine test: no Electron, API keys, or network needed.
 * Checks the the AI model prompt, the Markdown -> text / HTML / Word converters,
 * and the saved-draft store in a temp folder.
 * Run: node minutes-test.js
 */
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const minutes = require("./main/engine/minutes");
const exporter = require("./main/engine/export");
const store = require("./main/engine/minutesStore");
const { readBundledSample } = require("./main/engine/minutesPipeline");

// ---- Fixtures ---------------------------------------------------------------

const CLIP = {
  clipId: 339060,
  title: "Town Council Regular Session",
  date: "2025-04-02",
  time: "6:00 PM",
  durationSec: 5400,
  durationLabel: "1 hr 30 min",
  kind: "council",
  kindLabel: "Town Council",
  body: "Town Council",
  minutesSeq: null,
  index: [
    { id: 1, start: 0, end: 60, title: "CALL TO ORDER", level: 0 },
    { id: 2, start: 60, end: 120, title: "ROLL CALL", level: 0 },
    { id: 3, start: 900, end: 2400, title: "CONSENT AGENDA", level: 0 },
    { id: 4, start: null, end: null, title: "REGULAR AGENDA", level: 0 },
    { id: 5, start: 2400, end: 5300, title: "1. Discussion and possible action regarding Naranja Park", level: 1 },
  ],
};

const AGENDA = {
  date: "2025-04-02",
  time: "6:00 PM",
  title: "Town Council Regular Session",
  agendaText: [
    "REGULAR SESSION AT OR AFTER 6:00 PM",
    "CALL TO ORDER",
    "ROLL CALL",
    "CONSENT AGENDA",
    "A. Minutes - March 19, 2025",
    "REGULAR AGENDA",
    "1. Discussion and possible action regarding Naranja Park",
    "ADJOURNMENT",
  ].join("\n"),
  items: [{ number: "1.", text: "Discussion and possible action regarding Naranja Park", level: 1, memoUrl: null }],
  packetUrl: null,
  amended: false,
};

const ROSTER = {
  text: ['Mayor Joseph C. "Joe" Winfield', "Vice Mayor Melanie Barrett", 'Councilmember Harry "Mo" Greene II', "Town Clerk Mike Standish"].join("\n"),
  source: "built-in list",
};

const TRANSCRIPT = [
  "[00:00:05] Speaker 1: Good evening. I call the April 2nd regular session to order at 6:01 p.m.",
  "",
  "[00:01:10] Speaker 2: Mayor Winfield. Here. Vice Mayor Barrett. Here. Councilmember Greene. Here.",
  "",
  "[00:15:00] Speaker 1: Is there a motion on the consent agenda? Moved by Councilmember Greene, second by the Vice Mayor. All in favor? Motion carries.",
  "",
  "[01:28:00] Speaker 1: We are adjourned at 7:29 p.m.",
].join("\n");

const SAMPLE_MD = `# MINUTES
ORO VALLEY TOWN COUNCIL
REGULAR SESSION
APRIL 2, 2025
ORO VALLEY COUNCIL CHAMBERS
11000 N. LA CAÑADA DRIVE

## REGULAR SESSION AT OR AFTER 6:00 PM

## CALL TO ORDER

Mayor Winfield called the meeting to order at 6:01 p.m.

## ROLL CALL

Present:
- Joseph C. Winfield, Mayor
- Melanie Barrett, Vice-Mayor
- Harry Greene, Councilmember

## CONSENT AGENDA

A. Minutes - March 19, 2025

Motion by Councilmember Harry Greene, seconded by Vice-Mayor Melanie Barrett to approve Consent Agenda item (A).

Vote: 3 - 0 Carried

## REGULAR AGENDA

1. Discussion and possible action regarding Naranja Park <script>alert("x")</script>

Parks and Recreation Director Rosalyn Epting presented item #1 and included the following:
- Project Budget & Schedule
- Next Steps

Discussion ensued among Council and staff regarding item #1.

**Vote:** 3 - 0 Carried

## ADJOURNMENT

Mayor Winfield adjourned the meeting at 7:29 p.m.

_________________________________________
Prepared by: _______________________
Deputy Town Clerk

I hereby certify that the foregoing minutes are a true and correct copy of the minutes of the regular session of the Town of Oro Valley, Arizona held on the 2nd day of April 2025. I further certify that the meeting was called and held and that a quorum was present.

_________________________________________
Mike Standish
Town Clerk
`;

// ---- Minimal .docx (zip) reader ---------------------------------------------

/** Read one file out of a zip Buffer using the central directory. */
function unzipEntry(buf, wanted) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "zip end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      assert.equal(buf.readUInt32LE(local), 0x04034b50, "local file header");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compSize);
      return method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// ---- Tests ------------------------------------------------------------------

async function testPrompt() {
  const prompt = minutes.buildUserPrompt({
    clip: CLIP,
    agenda: AGENDA,
    transcript: TRANSCRIPT,
    index: CLIP.index,
    roster: ROSTER,
    publishedSample: readBundledSample(path.join(__dirname, "resources")),
    draft: "",
  });
  for (const tag of ["<council_roster", "<posted_agenda", "<video_index", "<published_minutes_sample>", "<transcript>"]) {
    assert.ok(prompt.includes(tag), `prompt has ${tag}`);
  }
  assert.ok(prompt.includes("Meeting: Town Council Regular Session"));
  assert.ok(prompt.includes('date="2025-04-02"'));
  assert.ok(prompt.includes("[00:40:00 - 01:28:20] 1. Discussion and possible action regarding Naranja Park"), "index timestamps");
  assert.ok(prompt.includes("\nREGULAR AGENDA\n"), "heading without a time keeps its title");
  assert.ok(prompt.includes("Discussion and possible action regarding Naranja Park"), "agenda item title");
  assert.ok(prompt.includes("Vice Mayor Melanie Barrett"), "roster");
  assert.ok(prompt.includes("Motion by Mayor Joseph C. Winfield"), "published sample text");
  assert.ok(prompt.includes("There is no current draft"), "no draft");
  assert.ok(prompt.includes("[00:15:00] Speaker 1:"), "transcript");
  assert.ok(prompt.indexOf("<transcript>") > prompt.indexOf("<published_minutes_sample>"), "transcript last");

  const revised = minutes.buildUserPrompt({
    clip: { ...CLIP, index: undefined },
    agenda: "CALL TO ORDER",
    transcript: TRANSCRIPT,
    roster: ROSTER.text,
    draft: SAMPLE_MD,
  });
  assert.ok(revised.includes("<current_draft>\n# MINUTES"), "draft included");
  assert.ok(revised.includes("<posted_agenda>\nCALL TO ORDER\n</posted_agenda>"), "string agenda");
  assert.ok(revised.includes("No video index is available"), "no index");

  const bare = minutes.buildUserPrompt({ clip: { title: "Test" }, transcript: "x" });
  assert.ok(bare.includes("No posted agenda is available"));

  for (const section of [
    "REGULAR SESSION AT OR AFTER 6:00 PM", "CALL TO ORDER", "ROLL CALL", "PLEDGE OF ALLEGIANCE", "UPCOMING MEETING ANNOUNCEMENTS",
    "MAYOR AND COUNCIL REPORTS ON CURRENT EVENTS", "TOWN MANAGER'S REPORT ON CURRENT EVENTS", "ORDER OF BUSINESS", "INFORMATIONAL ITEMS",
    "CALL TO AUDIENCE", "PRESENTATIONS", "CONSENT AGENDA", "REGULAR AGENDA", "FUTURE AGENDA ITEMS", "ADJOURNMENT", "EXECUTIVE SESSION",
    "RESUME REGULAR SESSION", "11000 N. LA CAÑADA DRIVE", "Vote: 7 - 0 Carried", "I hereby certify that the foregoing minutes",
    "a quorum was present", "Discussion ensued among Council and staff", "The following individuals spoke regarding item",
  ]) {
    assert.ok(minutes.SYSTEM_PROMPT.includes(section), `system prompt covers ${section}`);
  }
  assert.ok(/^claude-/.test(minutes.MODEL), "model id");
  assert.equal(minutes.MODEL, require("./main/engine/summarize").MODEL, "same model as summaries");
  console.log("ok  minutes prompt");
}

function testParse() {
  const blocks = exporter.parseMinutes(SAMPLE_MD);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(blocks[0], {
    type: "title",
    lines: ["MINUTES", "ORO VALLEY TOWN COUNCIL", "REGULAR SESSION", "APRIL 2, 2025", "ORO VALLEY COUNCIL CHAMBERS", "11000 N. LA CAÑADA DRIVE"],
  });
  assert.ok(types.includes("roster"), "roster block");
  const roster = blocks.find((b) => b.type === "roster");
  assert.equal(roster.label, "Present:");
  assert.deepEqual(roster.names, ["Joseph C. Winfield, Mayor", "Melanie Barrett, Vice-Mayor", "Harry Greene, Councilmember"]);
  const items = blocks.filter((b) => b.type === "item");
  assert.deepEqual(items.map((i) => i.label), ["A.", "1."]);
  assert.equal(items[0].text, "Minutes - March 19, 2025");
  const bullets = blocks.find((b) => b.type === "bullets");
  assert.deepEqual(bullets.items, ["Project Budget & Schedule", "Next Steps"]);
  assert.equal(blocks.filter((b) => b.type === "signature").length, 2);
  assert.equal(blocks.filter((b) => b.type === "heading").length, 6);
  assert.equal(exporter.footerText(blocks, CLIP), "Minutes, Oro Valley Town Council Regular Session");
  assert.equal(exporter.footerText([], { kind: "special" }), "Minutes, Oro Valley Town Council Special Session");
  assert.equal(exporter.shortDate("2025-11-19"), "11/19/25");
  console.log("ok  markdown parser");
}

function testText() {
  const text = exporter.minutesToText(SAMPLE_MD);
  assert.ok(text.startsWith("MINUTES\nORO VALLEY TOWN COUNCIL\nREGULAR SESSION\nAPRIL 2, 2025\n"), "title block");
  assert.ok(text.includes("\n\nROLL CALL\n\nPresent:  Joseph C. Winfield, Mayor\n          Melanie Barrett, Vice-Mayor\n"), "present block");
  assert.ok(text.includes("\nA. Minutes - March 19, 2025\n"), "lettered item");
  assert.ok(text.includes("\n1. Discussion and possible action regarding Naranja Park <script>alert(\"x\")</script>\n"), "item keeps text verbatim");
  assert.ok(text.includes("        Project Budget & Schedule\n        Next Steps"), "bullets indented");
  assert.ok(text.includes("\nVote: 3 - 0 Carried\n"), "bold markers removed");
  assert.ok(!text.includes("**") && !/^#|^- /m.test(text), "no markdown left");
  assert.ok(text.includes("I hereby certify"), "attestation");
  console.log("ok  minutes to text");
}

function testHtml() {
  const html = exporter.minutesToHtml(SAMPLE_MD);
  assert.ok(!html.includes("<script"), "script tag escaped");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"), "escaped text kept");
  assert.ok(html.includes('<header class="minutes-title"><div>MINUTES</div><div>ORO VALLEY TOWN COUNCIL</div>'), "title block");
  assert.ok(html.includes("<h2>CALL TO ORDER</h2>"), "heading");
  assert.ok(html.includes('<div class="roster"><span class="label">Present:</span><ul><li>Joseph C. Winfield, Mayor</li>'), "roster");
  assert.ok(html.includes('<p class="item"><span class="num">A.</span> Minutes - March 19, 2025</p>'), "item");
  assert.ok(html.includes("<ul><li>Project Budget &amp; Schedule</li><li>Next Steps</li></ul>"), "bullets, ampersand escaped");
  assert.ok(html.includes("<p><strong>Vote:</strong> 3 - 0 Carried</p>"), "bold");
  assert.ok(html.includes('<p class="signature">'), "signature line");
  assert.equal(exporter.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  console.log("ok  minutes to html");
}

async function testDocx() {
  const buf = await exporter.minutesToDocx(SAMPLE_MD, { clip: CLIP });
  assert.ok(Buffer.isBuffer(buf), "a Buffer");
  assert.equal(buf.subarray(0, 2).toString("latin1"), "PK", "zip signature");
  const xml = unzipEntry(buf, "word/document.xml");
  assert.ok(xml, "word/document.xml present");
  assert.ok(xml.includes("CALL TO ORDER"), "heading in document.xml");
  assert.ok(xml.includes("Joseph C. Winfield, Mayor"), "roster in document.xml");
  assert.ok(xml.includes("<w:tbl>"), "roster table");
  assert.ok(xml.includes("I hereby certify"), "attestation");
  assert.ok(xml.includes('w:ascii="Arial"') && xml.includes('w:val="22"'), "Arial 11pt runs");
  assert.ok(xml.includes("&lt;script&gt;"), "XML escaped");
  const footer = unzipEntry(buf, "word/footer1.xml");
  assert.ok(footer && footer.includes("4/2/25") && footer.includes("Minutes, Oro Valley Town Council Regular Session"), "page footer");
  assert.ok(footer.includes("PAGE"), "page number field");
  console.log(`ok  minutes to docx (${buf.length.toLocaleString()} bytes)`);
}

function testStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ov-minutes-"));
  try {
    const dir = store.minutesDir(tmp);
    assert.equal(path.basename(dir), "Minutes");
    assert.ok(fs.existsSync(dir));
    const fake = { clipId: 339060, title: "Town Council Regular Session", date: "2025-04-02" };
    assert.ok(store.minutesStem(fake).startsWith("April 2 2025 "), "stem starts with the date");
    assert.ok(store.minutesStem(fake).endsWith(" Minutes DRAFT (video 339060)"), "stem ends with the video number");
    assert.equal(store.findMinutes(dir, 339060), null);

    const notes = ["[00:15:00] Vote count not confirmed -- only \"all in favor\" was heard.", "Speaker at [00:40:00] did not state a name."];
    const { mdPath } = store.saveMinutes(dir, fake, SAMPLE_MD, { notes });
    assert.ok(fs.existsSync(mdPath));
    assert.equal(store.findMinutes(dir, 339060), mdPath);
    assert.equal(store.indexMinutes(dir).get(339060), mdPath);

    const read = store.readMinutes(mdPath);
    assert.equal(read.markdown, SAMPLE_MD.trim(), "markdown round-trips without the metadata comment");
    assert.deepEqual(read.notes, notes, "notes survive, including a double dash");
    assert.ok(!isNaN(Date.parse(read.savedAt)), "savedAt is a date");
    assert.ok(fs.readFileSync(mdPath, "utf-8").startsWith("<!-- oro-valley-minutes-draft"), "metadata comment on top");

    // Saving again under a corrected date replaces the file and keeps the old one.
    const { mdPath: mdPath2 } = store.saveMinutes(dir, { ...fake, date: "2025-04-03" }, "# MINUTES\nEDITED", { notes: [] });
    assert.notEqual(mdPath2, mdPath);
    assert.ok(!fs.existsSync(mdPath), "old draft removed");
    assert.equal(store.findMinutes(dir, 339060), mdPath2);
    assert.equal(store.readMinutes(mdPath2).markdown, "# MINUTES\nEDITED");
    assert.deepEqual(store.readMinutes(mdPath2).notes, []);
    const previous = fs.readdirSync(path.join(dir, "Previous"));
    assert.equal(previous.length, 1, "previous version kept");
    assert.ok(previous[0].includes("(video 339060)"));

    // A file without the comment (hand-written) still reads.
    const plainPath = path.join(dir, "Hand Written Minutes DRAFT (video 1).md");
    fs.writeFileSync(plainPath, "# MINUTES\nBy hand\n", "utf-8");
    assert.equal(store.readMinutes(plainPath).markdown, "# MINUTES\nBy hand");
    assert.deepEqual(store.readMinutes(plainPath).notes, []);
    assert.ok(store.readMinutes(plainPath).savedAt, "savedAt from mtime");
    console.log("ok  minutes store");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testPipelineGuards() {
  const { draftMinutes } = require("./main/engine/minutesPipeline");
  await assert.rejects(
    () => draftMinutes({ clip: CLIP, keys: {}, dirs: { output: os.tmpdir(), temp: os.tmpdir(), reference: path.join(__dirname, "resources") } }),
    (e) => e.needsKey === true && e.keyKind === "anthropic"
  );
  await assert.rejects(() => minutes.writeMinutes({ clip: CLIP, transcript: TRANSCRIPT }, { apiKey: "" }), (e) => e.needsKey === true);
  await assert.rejects(() => minutes.writeMinutes({ clip: CLIP, transcript: "   " }, { apiKey: "sk-test" }), /no transcript/);
  assert.ok(readBundledSample(path.join(__dirname, "resources")).includes("ORO VALLEY TOWN COUNCIL"), "bundled sample readable");
  assert.ok(readBundledSample(path.join(os.tmpdir(), "does-not-exist")).includes("ORO VALLEY TOWN COUNCIL"), "falls back to the app's resources folder");
  console.log("ok  pipeline guards");
}

(async () => {
  await testPrompt();
  testParse();
  testText();
  testHtml();
  await testDocx();
  testStore();
  await testPipelineGuards();
  console.log("All minutes tests passed.");
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

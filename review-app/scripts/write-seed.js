/* Writes main/seed.json from the ANTHROPIC_API_KEY and DEEPGRAM_API_KEY environment
 * variables, so a "seeded" installer can hand the Town's keys to each staff PC on first
 * launch (the app stores them encrypted and then ignores the seed).
 *
 *   $env:ANTHROPIC_API_KEY = "sk-ant-..."; $env:DEEPGRAM_API_KEY = "..."; npm run dist:seeded
 *
 * With --clear it deletes the seed so a plain `npm run dist` never carries keys.
 * main/seed.json is git-ignored. A seeded installer must stay off the public Releases page:
 * anyone who has the file can read the keys out of it.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "main", "seed.json");

if (process.argv.includes("--clear")) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log("seed cleared");
  process.exit(0);
}

const anthropic = String(process.env.ANTHROPIC_API_KEY || "").trim();
const deepgram = String(process.env.DEEPGRAM_API_KEY || "").trim();
if (!anthropic && !deepgram) {
  console.error("Set ANTHROPIC_API_KEY and/or DEEPGRAM_API_KEY in the environment first.");
  process.exit(1);
}
if (anthropic && !anthropic.startsWith("sk-ant-")) {
  console.error("ANTHROPIC_API_KEY does not look like an Anthropic key (should start with sk-ant-).");
  process.exit(1);
}
fs.writeFileSync(
  file,
  JSON.stringify({ anthropicApiKey: anthropic, deepgramApiKey: deepgram, seededAt: new Date().toISOString() }, null, 2) + "\n"
);
console.log(`seed written (${[anthropic && "Anthropic", deepgram && "Deepgram"].filter(Boolean).join(", ")})`);

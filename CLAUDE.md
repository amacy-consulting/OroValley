# Oro Valley Council Meeting Dashboard

Town of Oro Valley, Arizona. Electron meeting-analysis app for staff (search, topics, ask-Claude, summaries, minutes drafts) plus a secondary static website widget for approved summaries. Built from the City of Eloy council widget; the untouched original is in `city-council-widget-main/` for reference only. Never edit it and never commit it.

## Folder map

- `widget/` – public widget, deployed as-is to GitHub Pages. `render.js` and `markdown.js` are also imported by the app's Summary preview: keep their export names and the `ecw-*` class names. `data/meetings.json` is written only by the app's publish step and ships empty.
- `review-app/main/main.js`, `preload.js` – Electron main process and IPC bridge.
- `review-app/main/engine/` – the work: Swagit client (video pages, HLS/MP4, video index), Destiny AgendaQuick client (meeting list, agendas, minutes), `media.js` (ffmpeg audio), `transcribe.js` (Deepgram), `transcripts.js` (transcript files), `summarize.js` (Claude summary), `minutes.js` / `minutesPipeline.js` / `minutesStore.js` / `export.js` (minutes drafting and Word export), `corpus.js` (in-memory index of transcripts, summaries, minutes drafts; mtime-cached), `search.js` (query syntax, ranked snippets, speaker stats), `topics.js` (watched keywords, per-month stats), `ask.js` (BM25 passage retrieval + Claude answer with citations), `jobs.js` (sequential bulk queue), `review.js` (review state, approve, publish), `github.js` (commit `widget/data/meetings.json`), `settings.js` (encrypted keys), `roster.js` (Council names).
- `review-app/renderer/` – React UI (Vite). `App.jsx` shell with views Meetings / Search / Topics / Ask Claude (`views/`), per-meeting panels in `views/meeting/` (Summary, Transcript, Minutes, Agenda), shared pieces in `components/`. Publishing sits under the Website ▾ menu.
- `review-app/resources/` – `keyterms.txt` (Deepgram, max 50 lines) and a sample of published minutes for the Town's format.
- `review-app/test-fixtures/` – saved Swagit and Destiny pages for offline tests.
- `tools/preview-widget.js` – serves `widget/` at http://localhost:5180/.
- `Website Embed Code.txt` – the only snippet that goes on orovalleyaz.gov (Granicus govAccess, Custom HTML component).

## Sources

- Video: Swagit, `https://orovalleyaz.new.swagit.com/videos/<id>`; HLS at `archive-stream.granicus.com/.../playlist.m3u8`, signed MP4 at `/videos/<id>/download`, deep link `/play/<id>/<seconds>`. Meeting ids are `swagit-<videoId>`.
- Agendas, minutes, meeting list: Destiny, `https://destinyhosted.com/agenda_publish.cfm?id=67682` with `&mt=ALL&get_month=M&get_year=Y` (list), `&dsp=ag&seq=N` (agenda), `&dsp=min&seq=N` (minutes).
- Roster: https://www.orovalleyaz.gov/Government/Mayor-and-Council. New Council sworn in 2026-11-04.

## Run and test

```powershell
cd review-app
npm install                 # once; downloads ffmpeg
npm test                    # offline smoke test, fixtures + fake GitHub, no keys
node minutes-test.js        # offline minutes engine test (npm test runs all three suites)
node search-test.js         # offline search/topics/ask/jobs test with timing
npm start                   # vite build + electron (clear ELECTRON_RUN_AS_NODE in VS Code first)
npm run e2e                 # live; needs DEEPGRAM_API_KEY / ANTHROPIC_API_KEY; E2E_STAGE=transcript stops after the transcript
npm run dist                # release\Oro Valley Council Dashboard Setup.exe
node ..\tools\preview-widget.js [--sample]
```

Env vars: `OV_USER_DATA`, `OV_DOCUMENTS`, `OV_CLIP_ID`, `OV_SCREENSHOT` (+ `OV_SCREENSHOT_CLICK`, `OV_SCREENSHOT_TYPE`, `OV_SCREENSHOT_AFTER` for headless UI checks), `OV_KEEP_AUDIO`, `OV_CHUNK_AFTER_SEC`, `OV_AUDIO_BITRATE`, `FFMPEG_BIN`.

## Files on the staff PC

- `Documents\Oro Valley Minutes\Transcripts\<Date> <Meeting> Transcript (video N).txt` – written once by the app, reused by every later step.
- `Documents\Oro Valley Minutes\Minutes\<Date> <Meeting> Minutes DRAFT (video N).md` – the app writes the first draft; the Town Clerk owns it after that. Exports (.docx, text) are the Clerk's.
- App userData – review state, summary drafts, `topics.json`, `asks.json` (last 50 questions), keys encrypted with `safeStorage` (DPAPI). Keys never go in code, fixtures, or git.

## Rules

- Analysis comes first: the user wants search, keyword tracking, and questions across meetings; the website widget is secondary and must stay optional.

- Nothing is published without staff approval: only meetings a reviewer marked **Approved** reach `widget/data/meetings.json`, and only through **Publish to website**.
- The minutes draft is never published by the app. It is a starting point for the Town Clerk, not the official minutes.
- The widget footer must keep the "not the official minutes" note and the link to the Town's Meetings and Agendas page.
- The repository is public: no keys, tokens, transcripts, or minutes drafts in git.

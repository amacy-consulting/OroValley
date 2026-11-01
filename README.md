# Oro Valley Council Meeting Dashboard

A meeting analysis tool for Town of Oro Valley, Arizona staff. It turns each Town Council meeting recording into a searchable transcript, a plain-language summary, and a draft of the minutes for the Town Clerk, then lets staff search every transcript by keyword, watch topics over time, and ask questions that are answered with timestamped citations. Everything stays on the staff PC: the app publishes nothing anywhere, and the minutes draft is a starting point for the Clerk, not the official minutes.

```
Swagit video + Destiny agenda ──► Dashboard app (staff PC)
                                  transcribe, summarize, draft minutes,
                                  search, topics, Ask
```

- **Swagit** (`orovalleyaz.new.swagit.com`) is the Town's public video archive. Each video page has an HLS stream, a signed MP4 download, and a "video index" of agenda items with timestamps. The app reads the archive for new recordings and streams the audio through the bundled ffmpeg, transcribes it with Deepgram, and asks the AI model for the summary and the minutes draft.
- **Destiny AgendaQuick** (`destinyhosted.com`, id 67682) is the Town's agenda system. It gives the month-by-month meeting list, the posted agenda for each meeting (items, memo links, packet PDF), the published minutes, and the link from each meeting to its Swagit video.
- **Dashboard app** (`review-app/`, Electron) has four views. **Meetings** lists every recording and gives each one four tabs: **Summary**, **Transcript**, **Minutes**, and **Agenda**. **Search** finds words and phrases across every saved transcript, summary, and minutes draft. **Topics** watches a list of keywords and shows mentions by month and by meeting. **Ask** answers a question from the transcripts with citations that open the recording at that moment. Transcripts and minutes drafts stay on the PC as files; a bulk **Transcribe meetings…** dialog fills the archive.

## Folders

| Folder | What is in it |
| --- | --- |
| `review-app/` | Staff dashboard app. `main/engine/` holds the Swagit and Destiny clients, ffmpeg audio, Deepgram transcription, transcript files, AI summaries and minutes drafts, the review state, and the search, topics and Ask engines. |
| `review-app/resources/keyterms.txt` | Names and places Deepgram should spell correctly. Update it when Council or staff change. |
| `review-app/resources/minutes-sample-*.txt` | A published set of Town minutes that shows the AI model the Town's format for the draft. |
| `review-app/test-fixtures/` | Saved Swagit and Destiny pages and a sample Deepgram response for the offline tests. |
| `Start Oro Valley Council Dashboard.cmd` | Double-click launcher that runs the app from source (installs dependencies the first time). |
| `city-council-widget-main/` | The City of Eloy app this project was built from. Reference only; not part of the build. |

## Install or start the app

Two ways to run the dashboard on a staff PC:

- **Installer (recommended for staff).** Run `review-app\release\Oro Valley Council Dashboard Setup.exe`. It installs for the current Windows account only (no admin rights), adds a Start menu and desktop shortcut, and bundles everything including ffmpeg. Build it with `npm run dist` (see Develop) and hand the .exe to staff; it contains no keys.
- **Start script (from source).** Double-click **`Start Oro Valley Council Dashboard.cmd`** at the top of this folder. It needs Node.js installed; the first run downloads dependencies and Electron (a few minutes), later runs start in seconds.

Either way, open **Settings** on first launch and paste the two keys described below.

## One-time setup

**Keys.** In the dashboard app's Settings on each PC, paste two secrets. They are encrypted for that Windows account (Electron `safeStorage`, Windows DPAPI) and never leave the PC. The installer contains no keys.

- **Anthropic API key.** The AI model writes each summary and each minutes draft from the transcript and agenda, and answers questions in Ask. Use a dedicated Console workspace with a monthly spend limit. A summary or a minutes draft sends one meeting transcript each; a question sends only the passages that bear on it.
- **Deepgram API key.** Transcribes the recording (Nova-3 with speaker separation; about $0.0043 per minute, roughly $0.50 for a two-hour meeting). Create a dedicated Deepgram project and key, with a usage limit if available.

## Analysis: search, topics, and questions

Everything below works on the transcripts, summaries, and minutes drafts saved on the PC, so the first step is to build the archive: click **Transcribe meetings…**, pick the meetings (by default, Town Council meetings from the last 12 months without a transcript), check the Deepgram cost estimate, and start. The queue runs one meeting at a time in the background; a **Working n/m** pill in the top bar shows progress and opens the queue. The same dialog can also write summaries and minutes drafts for each meeting.

**Search.** Type words or a `"quoted phrase"`; `-word` excludes, `word*` matches a prefix. Filter by content type, meeting body, and dates; sort by relevance or date. Results are grouped by meeting with the matching lines highlighted, the time and speaker label, a **Watch at** link that opens Swagit at that second, and a click that opens the transcript at that line. **Save as topic** turns the query into a watched topic.

**Topics.** A watch list of keywords (each topic can have several terms or phrases). For each topic: mentions per month for the last year, and the meetings that mention it with the first-mention time. Topics that occur in a meeting show as chips in that meeting's header.

**Ask.** Ask a question in plain words, scoped to all meetings, a date range, Town Council only, or one meeting. The app finds the most relevant transcript passages, sends only those to the AI model, and shows the answer with numbered citations; each citation lists the meeting, the time, and the quoted line, and opens the transcript or the video there. Answers come from automatic transcripts and staff summaries, so verify against the video before relying on them. The last 50 questions are kept on the PC.

## After each meeting (twice a month)

Open **Oro Valley Council Dashboard** → **Check for new meetings**. New Swagit recordings appear in the list with nothing written yet. Other boards and commissions and duplicate recordings of one date get a yellow note; a very short recording is flagged once its length is known; test recordings are hidden automatically. **Hide** tucks away recordings you don't need (and **Unhide** brings them back). Pick the meeting; its four tabs work in any order, but the transcript is made first whichever tab asks for it.

**Transcript tab.** Click **Transcribe now**. The first time takes about 5 to 15 minutes: the app downloads the audio from Swagit, transcribes it, and saves the result. The transcript shows in the app with search; each timestamp opens the Swagit player at that moment. "Speaker N" labels are automatic and do not identify people.

**Summary tab.** Click **Write summary**. The AI model writes a plain-language overview and summary from the transcript and the posted agenda; check them against the video and the agenda (links are under the fields), edit, and save. The summary is an analysis artifact: it stays on the PC, summaries are searchable, and they feed Ask.

**Minutes tab.** Click **Draft minutes**. The AI model writes the minutes in the Town's own format from the transcript, the agenda, and the Swagit video index, and the draft opens in a markdown editor with a preview. Export it to Word (`.docx`), to text, or to the clipboard. **Compare with published minutes** shows the Town Clerk's final minutes from Destiny beside the draft, once they are posted. The draft is a starting point for the Town Clerk and nothing more: the app never sends it anywhere, and the Clerk's own minutes remain the only official record.

**Agenda tab.** The posted agenda items with their memo links, the packet PDF, and the video chapters from Swagit, each linking to that point in the recording.

Transcripts are saved in `Documents\Oro Valley Minutes\Transcripts` and minutes drafts in `Documents\Oro Valley Minutes\Minutes` (see "Files" below). A meeting is transcribed once; **Rewrite summary** or a new minutes draft reuses the saved transcript and takes a minute or two.

## How a transcript, summary, and minutes draft are made

1. **Meeting list.** Destiny's listing (`agenda_publish.cfm?id=67682&mt=ALL&get_month=M&get_year=Y`) gives every meeting in a month with its agenda (`&dsp=ag&seq=N`), its published minutes (`&dsp=min&seq=N`), and a link to its Swagit video. Only meetings with a posted video appear in the list. Meetings are identified by their Swagit video number (`swagit-405463`); the search box above the list finds one by date or name.
2. **Video.** Each Swagit page (`orovalleyaz.new.swagit.com/videos/<id>`) carries an HLS stream on `archive-stream.granicus.com` (`playlist.m3u8`) and a signed MP4 at `/videos/<id>/download`. The bundled ffmpeg reads the MP4 (falling back to the stream) and keeps only a small mono MP3 (about 30 MB per hour). Deep links to a moment in the video use `/play/<id>/<seconds>`.
3. **Transcript.** The MP3 goes to Deepgram (Nova-3, speaker separation, with the names in `keyterms.txt`) and is saved as `<Date> <Meeting> Transcript (video N).txt`. Recordings longer than four hours are sent in one-hour parts.
4. **Agenda and video index.** The posted agenda is read from Destiny; the video index (agenda items with timestamps) is read from the Swagit page. If there is no agenda, the summary and the minutes draft come from the transcript alone and the app says so.
5. **Summary.** The AI model writes the overview and the full summary at a sixth-grade reading level, spelling names from the Council roster on orovalleyaz.gov (Government → Mayor and Council). The AI model is told to name a Councilmember only when the transcript makes it clear, and to take item titles, numbers, and amounts from the agenda. The reviewer still checks it.
6. **Minutes draft.** The AI model writes the minutes in the Town's format, shown by a sample of published minutes in `review-app/resources/`, with roll call, each agenda item, motions, movers and seconders, and votes as far as the transcript supports them. Anything it could not confirm is marked for the Clerk. The draft is saved as `<Date> <Meeting> Minutes DRAFT (video N).md`.

## Files

| Folder | Who writes it |
| --- | --- |
| `Documents\Oro Valley Minutes\Transcripts\` | The app, once per recording. Safe to copy or share within the Town; a deleted transcript is made again on request (and paid for again). |
| `Documents\Oro Valley Minutes\Minutes\` | The app writes the first draft; the Town Clerk owns it from then on. Edits in the app's editor are saved to the same file. |
| App data (`%APPDATA%\oro-valley-council-dashboard`) | Review state, drafts of summaries, watched topics, the last 50 questions, and the encrypted keys. Per Windows account. |

## Develop

```powershell
cd review-app
npm install                              # first time only; downloads ffmpeg (needs access to GitHub)
node node_modules\electron\install.js    # if npm held back Electron's download script
npm test                                 # offline tests: sources + review state (fixtures), minutes engine, search/topics/ask engine; no keys
node search-test.js                      # the search engine test alone, with timing over 100 generated transcripts
npm start                                # builds the screens and opens the app
npm run dist                             # builds release\Oro Valley Council Dashboard Setup.exe

# End to end on the newest council meeting, through the same code path as the app:
$env:DEEPGRAM_API_KEY = "..."; $env:E2E_STAGE = "transcript"; npm run e2e     # transcript only
$env:ANTHROPIC_API_KEY = "sk-ant-..."; Remove-Item Env:E2E_STAGE; npm run e2e  # full summary
# $env:OV_CLIP_ID = "405463" picks a Swagit video.
```

From VS Code's terminal, clear `ELECTRON_RUN_AS_NODE` before `npm start` (`$env:ELECTRON_RUN_AS_NODE = $null`). Otherwise Electron starts as plain Node and fails.

Optional environment overrides:

| Variable | Effect |
| --- | --- |
| `OV_USER_DATA` | Folder for review state and keys, to keep a test run away from the real ones |
| `OV_DOCUMENTS` | Folder used instead of `Documents` for transcripts and minutes drafts |
| `OV_CLIP_ID` | Swagit video number for `npm run e2e` (default: the newest council meeting) |
| `OV_SCREENSHOT` | `<file.png>` captures the window and exits (dev helper) |
| `OV_KEEP_AUDIO` | `1` keeps the temporary MP3 in `%TEMP%\ov-minutes` for troubleshooting |
| `OV_CHUNK_AFTER_SEC` | Recordings longer than this are transcribed in one-hour parts (default 4 hours). Deepgram timeouts also fall back to parts. |
| `OV_AUDIO_BITRATE` | MP3 bitrate for the Deepgram upload (default `64k`) |
| `FFMPEG_BIN` | Use a different ffmpeg.exe |

## Third-party components

- **ffmpeg.** The installer bundles an unmodified ffmpeg 6.1.1 build (from the `ffmpeg-static` npm package, gyan.dev "essentials" build), licensed under the GPL v3. Source: https://ffmpeg.org/download.html and https://www.gyan.dev/ffmpeg/builds/. The app runs it as a separate program.
- **docx** (npm, MIT). Writes the Word export of the minutes draft.
- **Deepgram** and **Anthropic** are paid services called with the keys in Settings.

## History

- **2026-11-01 (v1.2):** Removed website publishing (widget, GitHub Pages, GitHub token). The app is a staff analysis tool only. Desktop icon is the Town seal.
- **2026-10-31 (v1.1):** Reframed as an analysis tool: Search across all transcripts, summaries, and minutes drafts; watched Topics with monthly trends; Ask with timestamped citations; bulk transcription queue; publishing moved under a Website menu. Town-brand restyle, installer icon, start script.
- **2026-10-30 (v1.0):** Built from the City of Eloy council widget (v2.0). Video from Swagit, agendas and minutes from Destiny AgendaQuick. Adds Transcript, Minutes, and Agenda tabs; meeting ids are `swagit-<videoId>`.

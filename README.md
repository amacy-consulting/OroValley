# Oro Valley Council Meeting Dashboard

A staff tool for the Town of Oro Valley, Arizona, that turns each Town Council meeting recording into a transcript, a plain-language summary for the Town website, and a draft of the minutes for the Town Clerk. Nothing reaches the website until a staff member reviews and approves it, and the minutes draft is never published by the app at all.

```
Swagit video + Destiny agenda ──► Dashboard app (staff PC) ──► GitHub: widget/data/meetings.json ──► GitHub Pages ──► iframe on orovalleyaz.gov
                                  transcribe, summarize,         commit triggers deploy
                                  draft minutes, review,
                                  approve, publish
```

- **Swagit** (`orovalleyaz.new.swagit.com`) is the Town's public video archive. Each video page has an HLS stream, a signed MP4 download, and a "video index" of agenda items with timestamps. The app reads the archive for new recordings and streams the audio through the bundled ffmpeg, transcribes it with Deepgram, and asks Claude for the summary and the minutes draft.
- **Destiny AgendaQuick** (`destinyhosted.com`, id 67682) is the Town's agenda system. It gives the month-by-month meeting list, the posted agenda for each meeting (items, memo links, packet PDF), the published minutes, and the link from each meeting to its Swagit video.
- **Dashboard app** (`review-app/`, Electron) lists meetings and gives each one four tabs: **Summary**, **Transcript**, **Minutes**, and **Agenda**. The reviewer edits, approves, and publishes summaries; transcripts and minutes drafts stay on the PC as files.
- **Widget** (`widget/`) is a static page: the latest meeting with an overview, a "Read the full summary" expander and a video link, then earlier meetings, plus a "not the official minutes" note. It is embedded in an iframe on the Town website.

## Folders

| Folder | What is in it |
| --- | --- |
| `widget/` | The website widget, deployed as-is to GitHub Pages. `data/meetings.json` holds the approved summaries and is written only by the dashboard app. It ships empty. |
| `review-app/` | Staff dashboard app. `main/engine/` holds the Swagit and Destiny clients, ffmpeg audio, Deepgram transcription, transcript files, Claude summary, Claude minutes draft, review workflow, and GitHub publishing. |
| `review-app/resources/keyterms.txt` | Names and places Deepgram should spell correctly. Update it when Council or staff change. |
| `review-app/resources/minutes-sample-*.txt` | A published set of Town minutes that shows Claude the Town's format for the draft. |
| `review-app/test-fixtures/` | Saved Swagit and Destiny pages and a sample Deepgram response for the offline tests. |
| `tools/preview-widget.js` | Previews the widget locally, optionally with sample data. |
| `samples/` | Sample data for the local preview. Kept out of git (`.gitignore`). |
| `.github/workflows/pages.yml` | Deploys `widget/` to GitHub Pages on every change. |
| `Start Oro Valley Council Dashboard.cmd` | Double-click launcher that runs the app from source (installs dependencies the first time). |
| `city-council-widget-main/` | The City of Eloy app this project was built from. Reference only; not part of the build. |

## Install or start the app

Two ways to run the dashboard on a staff PC:

- **Installer (recommended for staff).** Run `review-appeleaseOro Valley Council Dashboard Setup.exe`. It installs for the current Windows account only (no admin rights), adds a Start menu and desktop shortcut, and bundles everything including ffmpeg. Build it with `npm run dist` (see Develop) and hand the .exe to staff; it contains no keys.
- **Start script (from source).** Double-click **`Start Oro Valley Council Dashboard.cmd`** at the top of this folder. It needs Node.js installed; the first run downloads dependencies and Electron (a few minutes), later runs start in seconds.

Either way, open **Settings** on first launch and paste the three keys described below.

## One-time setup

1. **Repository.** Create a public repository (the app defaults to `amacy-consulting/OroValley`; change it in the app's Settings if the name differs). It contains no keys or tokens. Every version of the published summaries stays visible in its history, so review carefully before publishing. In Settings → Code security, turn on **Secret scanning** and **Push protection**. Commit with your GitHub "noreply" email address rather than a Town address. Do not commit `city-council-widget-main/`, `samples/`, or anything from `Documents\Oro Valley Minutes`.
2. **Turn on Pages.** In the repository, open Settings → Pages and set Source to **GitHub Actions**. The widget is then served at `https://amacy-consulting.github.io/OroValley/`.
3. **Keys.** In the dashboard app's Settings on each reviewer's PC, paste three secrets. They are encrypted for that Windows account (Electron `safeStorage`, Windows DPAPI) and never leave the PC. The installer contains no keys.
   - **Anthropic API key.** Claude writes each summary and each minutes draft from the transcript and agenda. Use a dedicated Console workspace with a monthly spend limit. A summary or a minutes draft sends one meeting transcript each.
   - **Deepgram API key.** Transcribes the recording (Nova-3 with speaker separation; about $0.0043 per minute, roughly $0.50 for a two-hour meeting). Create a dedicated Deepgram project and key, with a usage limit if available.
   - **GitHub token.** A fine-grained personal access token from github.com → Settings → Developer settings, limited to this one repository, with **Contents: Read and write** and an expiry date.
4. **Embed on orovalleyaz.gov.** The Town website runs on Granicus govAccess. Add a Custom HTML / embed component to the page and paste the contents of **`Website Embed Code.txt`** (top of this folder). This is the only code that goes into the website. Never paste files from `widget/` there; they only work on GitHub Pages.

   ```html
   <iframe src="https://amacy-consulting.github.io/OroValley/"
           title="Town Council meeting summaries"
           style="width:100%; height:900px; border:0;" loading="lazy"></iframe>
   <script src="https://amacy-consulting.github.io/OroValley/embed.js" async></script>
   ```

   The script resizes the iframe to fit. If the website strips scripts, the iframe still works at the fixed height and scrolls inside. Add `?count=3` to the `src` to show fewer meetings, for example in a sidebar.

## After each meeting (twice a month)

Open **Oro Valley Council Dashboard** → **Check for new meetings**. New Swagit recordings appear under **To review** with nothing written yet. Other boards and commissions and duplicate recordings of one date get a yellow note; a very short recording is flagged once its length is known. Pick the meeting; its four tabs work in any order, but the transcript is made first whichever tab asks for it.

**Transcript tab.** Click **Transcribe now**. The first time takes about 5 to 15 minutes: the app downloads the audio from Swagit, transcribes it, and saves the result. The transcript shows in the app with search; each timestamp opens the Swagit player at that moment. "Speaker N" labels are automatic and do not identify people.

**Summary tab.** Click **Write summary with Claude**. The app reads the posted agenda from Destiny and the saved transcript and writes an overview and a full summary. Check them against the video and the agenda (links are under the fields). Edit; the right side shows exactly how the summary will look on the website. Click **Approve**, or **Hide** for recordings that shouldn't be published. Then click **Publish to website**. The site updates within a few minutes. Editing or hiding an approved meeting and publishing again updates or removes it. If two people review on different PCs, each **Check for new meetings** picks up what the other published, and the app refuses to publish over changes it hasn't seen.

**Minutes tab.** Click **Draft minutes with Claude**. Claude writes the minutes in the Town's own format from the transcript, the agenda, and the Swagit video index, and the draft opens in a markdown editor with a preview. Export it to Word (`.docx`), to text, or to the clipboard. **Compare with published minutes** shows the Town Clerk's final minutes from Destiny beside the draft, once they are posted. The draft is a starting point for the Town Clerk and nothing more: the app never publishes it, it is not posted to the website or to GitHub, and the Clerk's own minutes remain the only official record.

**Agenda tab.** The posted agenda items with their memo links, the packet PDF, and the video chapters from Swagit, each linking to that point in the recording.

Transcripts are saved in `Documents\Oro Valley Minutes\Transcripts` and minutes drafts in `Documents\Oro Valley Minutes\Minutes` (see "Files" below). A meeting is transcribed once; **Rewrite with Claude** or a new minutes draft reuses the saved transcript and takes a minute or two.

## How a transcript, summary, and minutes draft are made

1. **Meeting list.** Destiny's listing (`agenda_publish.cfm?id=67682&mt=ALL&get_month=M&get_year=Y`) gives every meeting in a month with its agenda (`&dsp=ag&seq=N`), its published minutes (`&dsp=min&seq=N`), and a link to its Swagit video. Only meetings with a posted video appear in the list. Meetings are identified by their Swagit video number (`swagit-405463`); the search box above the list finds one by date or name.
2. **Video.** Each Swagit page (`orovalleyaz.new.swagit.com/videos/<id>`) carries an HLS stream on `archive-stream.granicus.com` (`playlist.m3u8`) and a signed MP4 at `/videos/<id>/download`. The bundled ffmpeg reads the MP4 (falling back to the stream) and keeps only a small mono MP3 (about 30 MB per hour). Deep links to a moment in the video use `/play/<id>/<seconds>`.
3. **Transcript.** The MP3 goes to Deepgram (Nova-3, speaker separation, with the names in `keyterms.txt`) and is saved as `<Date> <Meeting> Transcript (video N).txt`. Recordings longer than four hours are sent in one-hour parts.
4. **Agenda and video index.** The posted agenda is read from Destiny; the video index (agenda items with timestamps) is read from the Swagit page. If there is no agenda, the summary and the minutes draft come from the transcript alone and the app says so.
5. **Summary.** Claude writes the overview and the full summary at a sixth-grade reading level, spelling names from the Council roster on orovalleyaz.gov (Government → Mayor and Council). Claude is told to name a Councilmember only when the transcript makes it clear, and to take item titles, numbers, and amounts from the agenda. The reviewer still checks it.
6. **Minutes draft.** Claude writes the minutes in the Town's format, shown by a sample of published minutes in `review-app/resources/`, with roll call, each agenda item, motions, movers and seconders, and votes as far as the transcript supports them. Anything it could not confirm is marked for the Clerk. The draft is saved as `<Date> <Meeting> Minutes DRAFT (video N).md`.

## Files

| Folder | Who writes it |
| --- | --- |
| `Documents\Oro Valley Minutes\Transcripts\` | The app, once per recording. Safe to copy or share within the Town; a deleted transcript is made again on request (and paid for again). |
| `Documents\Oro Valley Minutes\Minutes\` | The app writes the first draft; the Town Clerk owns it from then on. Edits in the app's editor are saved to the same file. |
| App data (`%APPDATA%\oro-valley-council-dashboard`) | Review state, drafts of summaries, and the encrypted keys. Per Windows account. |
| `widget/data/meetings.json` in GitHub | Only the app's **Publish to website**, and only approved summaries. |

## Develop

```powershell
cd review-app
npm install                              # first time only; downloads ffmpeg (needs access to GitHub)
node node_modules\electron\install.js    # if npm held back Electron's download script
npm test                                 # offline smoke test with saved Swagit/Destiny fixtures and a fake GitHub (no keys)
node minutes-test.js                     # offline minutes engine test (writes to minutes-test-output\)
npm start                                # builds the screens and opens the app
npm run dist                             # builds release\Oro Valley Council Dashboard Setup.exe

# End to end on the newest council meeting, through the same code path as the app (nothing is published):
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
| `OV_KEEP_AUDIO` | `1` keeps the temporary MP3 in `%TEMP%ov-minutes` for troubleshooting |
| `OV_CHUNK_AFTER_SEC` | Recordings longer than this are transcribed in one-hour parts (default 4 hours). Deepgram timeouts also fall back to parts. |
| `OV_AUDIO_BITRATE` | MP3 bitrate for the Deepgram upload (default `64k`) |
| `FFMPEG_BIN` | Use a different ffmpeg.exe |

Widget preview:

```powershell
node tools\preview-widget.js            # http://localhost:5180/ with the real data file
node tools\preview-widget.js --sample   # with samples\meetings.sample.json
```

`widget/render.js` and `widget/markdown.js` are imported by the app's Summary preview as well as by the widget, so their export names and the `ecw-*` class names must stay as they are.

## Third-party components

- **ffmpeg.** The installer bundles an unmodified ffmpeg 6.1.1 build (from the `ffmpeg-static` npm package, gyan.dev "essentials" build), licensed under the GPL v3. Source: https://ffmpeg.org/download.html and https://www.gyan.dev/ffmpeg/builds/. The app runs it as a separate program.
- **docx** (npm, MIT). Writes the Word export of the minutes draft.
- **Deepgram** and **Anthropic** are paid services called with the keys in Settings; **GitHub Pages** hosts the widget.

## History

- **2026-10-30 (v1.0):** Built from the City of Eloy council widget (v2.0). Video from Swagit, agendas and minutes from Destiny AgendaQuick. Adds Transcript, Minutes, and Agenda tabs; meeting ids are `swagit-<videoId>`.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDate, latestHtml } from "../../../widget/render.js";
import { renderMarkdown } from "../../../widget/markdown.js";
import widgetCss from "../../../widget/widget.css?raw";
import { parseTranscript, speakerClass, playUrlFor, formatSeconds } from "./transcript.js";

const api = window.review;

const TABS = [
  { status: "review", label: "To review" },
  { status: "approved", label: "Approved" },
  { status: "hidden", label: "Hidden" },
];

const VIEWS = [
  { key: "summary", label: "Summary" },
  { key: "transcript", label: "Transcript" },
  { key: "minutes", label: "Minutes" },
  { key: "agenda", label: "Agenda" },
];

const PENDING_LABELS = {
  add: "Approved, not yet on the website",
  update: "Edited since it was published",
  remove: "Will be removed from the website",
};

const STATUS_LABELS = { review: "Needs review", approved: "Approved", hidden: "Hidden" };

const JOB_LABELS = { summary: "Writing the summary", transcript: "Transcribing", minutes: "Drafting the minutes" };

// Length targets, matching what Claude is asked for.
const OVERVIEW_WORDS = 45;
const DETAILS_WORDS = 200;

// The Town's official seal, when Communications has supplied one (see assets/README.txt).
// import.meta.glob resolves to an empty object when the file is absent, so the build
// passes either way and the drawn badge below is used instead.
const sealModules = import.meta.glob("./assets/town-seal.png", { eager: true, import: "default" });
const SEAL_URL = sealModules["./assets/town-seal.png"] || null;

/** The Town mark: the official seal when present, otherwise an original badge in the
 *  brand colours (navy sky, gold sun, blue Santa Catalina silhouette, white horizon). */
function Mark({ size = 40 }) {
  if (SEAL_URL) {
    return <img className="mark mark-seal" src={SEAL_URL} width={size} height={size} alt="" aria-hidden="true" />;
  }
  const clip = `mark-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="19" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="23" fill="#002d74" />
      <circle cx="24" cy="24" r="19" fill="#e9f0f7" />
      <circle cx="29.5" cy="17" r="5.5" fill="#f7b917" />
      <g clipPath={`url(#${clip})`}>
        <path d="M0 34 L12 21 L19 28 L26 16 L33 26 L38 22 L48 34 Z" fill="#236298" />
        <rect x="0" y="34" width="48" height="14" fill="#0d5b9a" />
        <path d="M0 34 H48" stroke="#ffffff" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/** A four-point sparkle, shown before every action that asks Claude to write.
 *  Purely decorative; it has no text so button labels stay unchanged. */
function Sparkle() {
  return (
    <svg className="sparkle" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 C8.6 5 9.9 6.4 14.5 8 C9.9 9.6 8.6 11 8 14.5 C7.4 11 6.1 9.6 1.5 8 C6.1 6.4 7.4 5 8 1.5 Z" fill="currentColor" />
      <path d="M13 1 C13.2 2.2 13.7 2.8 15 3 C13.7 3.2 13.2 3.8 13 5 C12.8 3.8 12.3 3.2 11 3 C12.3 2.8 12.8 2.2 13 1 Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/** Small status icon for banners (decorative). */
function BannerIcon({ kind }) {
  if (kind === "ok") {
    return (
      <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.8 8.2 L7 10.4 L11.3 5.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5 V8.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="0.95" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.8 L15 13.8 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6 V9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.95" fill="currentColor" />
    </svg>
  );
}

/** Magnifier for search fields (decorative). */
function SearchIcon() {
  return (
    <svg className="search-icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.3 10.3 L14.2 14.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function WordCount({ text, limit }) {
  const words = (String(text).replace(/[#*_\-[\]()]/g, " ").match(/\S+/g) || []).length;
  return (
    <span className={words > limit ? "word-count over" : "word-count"}>
      {words} / {limit} words
    </span>
  );
}

function fieldsOf(draft) {
  return {
    date: draft.date || "",
    title: draft.title || "",
    overview: draft.overview || "",
    details: draft.details || "",
    recordingUrl: draft.recordingUrl || "",
  };
}

function hasSummary(fields) {
  return Boolean(String(fields.overview).trim() || String(fields.details).trim());
}

function shortDate(iso) {
  return formatDate(iso, "short") || "Date needed";
}

function savedOn(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function savedAtTime(iso) {
  return iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
}

function baseName(p) {
  return String(p || "").split(/[\\/]/).pop();
}

function Link({ url, children }) {
  return (
    <button className="link-button" onClick={() => api.openExternal(url)}>
      {children}
    </button>
  );
}

function Preview({ draft }) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${widgetCss}</style></head>
    <body><main class="ecw">${latestHtml(draft, { open: true })}</main></body></html>`;
  return (
    <iframe
      className="preview-frame"
      title="Website preview"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
    />
  );
}

/** Close on Escape, for modals and drawers. */
function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Settings({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({
    githubRepo: settings.githubRepo,
    githubBranch: settings.githubBranch,
    widgetUrl: settings.widgetUrl,
    githubToken: "",
    anthropicApiKey: "",
    deepgramApiKey: "",
  });
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  useEscape(onClose);

  async function save() {
    const update = { githubRepo: form.githubRepo, githubBranch: form.githubBranch, widgetUrl: form.widgetUrl };
    for (const key of ["anthropicApiKey", "deepgramApiKey", "githubToken"]) {
      if (form[key].trim()) update[key] = form[key];
    }
    const result = await api.saveSettings(update);
    if (!result.ok) return setError(result.error);
    onSaved(result.state);
  }

  async function remove(key) {
    const result = await api.saveSettings({ [key]: "" });
    if (result.ok) onSaved(result.state, true);
  }

  const secret = (label, key, saved, placeholder) => (
    <label>
      {label} {saved && <span className="saved">saved</span>}
      <input
        type="password"
        value={form[key]}
        onChange={set(key)}
        placeholder={saved ? "Leave blank to keep the saved one" : placeholder}
      />
    </label>
  );
  const removeButton = (key, saved, text) =>
    saved && (
      <>
        {" "}
        <button className="link-button" onClick={() => remove(key)}>
          {text}
        </button>
      </>
    );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal">
        <h2 id="settings-title">Settings</h2>

        <h3>Writing summaries and minutes</h3>
        {secret("Anthropic API key", "anthropicApiKey", settings.hasAnthropicApiKey, "sk-ant-…")}
        <p className="hint">
          Claude writes each summary and drafts the minutes from the meeting transcript and the posted agenda. Use the
          Town's dedicated Console workspace with a monthly spend limit.
          {removeButton("anthropicApiKey", settings.hasAnthropicApiKey, "Remove saved key")}
        </p>
        {secret("Deepgram API key", "deepgramApiKey", settings.hasDeepgramApiKey, "Deepgram key")}
        <p className="hint">
          Deepgram turns the Swagit video into a transcript, about $0.40 for a 90-minute meeting. Each meeting's
          transcript is saved in Documents\Oro Valley Minutes and reused.
          {removeButton("deepgramApiKey", settings.hasDeepgramApiKey, "Remove saved key")}
        </p>

        <h3>Publishing summaries to the website</h3>
        <label>
          GitHub repository
          <input value={form.githubRepo} onChange={set("githubRepo")} placeholder="owner/repo" />
        </label>
        <label>
          Branch
          <input value={form.githubBranch} onChange={set("githubBranch")} />
        </label>
        {secret("GitHub token", "githubToken", settings.hasGithubToken, "github_pat_…")}
        <p className="hint">
          Use a fine-grained token limited to this one repository with <strong>Contents: Read and write</strong>. IT can
          provide it.
          {removeButton("githubToken", settings.hasGithubToken, "Remove saved token")}
        </p>
        <label>
          Widget web address
          <input value={form.widgetUrl} onChange={set("widgetUrl")} />
        </label>
        <p className="hint">The Town's keys are encrypted for your Windows account and stay on this computer.</p>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Highlight({ text, query }) {
  if (!query) return text;
  const parts = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, i)) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + query.length)}</mark>);
    i = at + query.length;
  }
  parts.push(text.slice(i));
  return parts;
}

/** A side drawer, for example the Town's published minutes next to the draft. */
function Drawer({ title, subtitle, onClose, children }) {
  useEscape(onClose);
  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-label={title}>
      <header className="drawer-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button onClick={onClose}>Close</button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}

/* ------------------------------------------------------------------ Summary */

function SummaryPanel({ meeting, onState, setNotice, busy, runJob, onDirty }) {
  const [fields, setFields] = useState(() => fieldsOf(meeting.draft));
  const [beforeRewrite, setBeforeRewrite] = useState(null);
  const [retranscribe, setRetranscribe] = useState(false);
  const saved = useMemo(() => fieldsOf(meeting.draft), [meeting.draft]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const draft = { ...meeting.draft, ...fields };
  const needsSummary = !hasSummary(fields);
  const set = (key) => (e) => {
    const value = e.target.value;
    setFields((f) => ({ ...f, [key]: value }));
  };

  useEffect(() => onDirty("summary", dirty), [dirty, onDirty]);

  // When the saved draft changes underneath (e.g. "Check for new meetings" adopted
  // another computer's published edit), follow it, unless the reviewer has edits.
  const savedJson = JSON.stringify(saved);
  const lastSaved = useRef(savedJson);
  useEffect(() => {
    const previous = lastSaved.current;
    lastSaved.current = savedJson;
    setFields((f) => (JSON.stringify(f) === previous ? saved : f));
  }, [savedJson]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist() {
    const result = await api.save(meeting.id, fields);
    if (!result.ok) {
      setNotice({ kind: "error", text: result.error });
      return false;
    }
    onState(result.state);
    return true;
  }

  async function save() {
    if (!(await persist())) return;
    setBeforeRewrite(null);
    setNotice({ kind: "ok", text: "Summary saved." });
  }

  async function resolve(choice) {
    if (choice === "mine" && dirty && !(await persist())) return;
    const result = await api.resolveConflict(meeting.id, choice);
    if (!result.ok) return setNotice({ kind: "error", text: result.error });
    if (choice === "website") setFields(fieldsOf({ ...meeting.draft, ...(meeting.conflict.website || {}) }));
    onState(result.state);
    setNotice({
      kind: "ok",
      text: choice === "mine" ? "Keeping your version. Publish when you're ready." : "Switched to the version on the website.",
    });
  }

  async function setStatus(status) {
    // Approving checks the saved overview and date, so save first. Moving away
    // from Approved changes the status first, so an empty overview can still be saved.
    if (status === "approved" && dirty && !(await persist())) return;
    const result = await api.setStatus(meeting.id, status);
    if (!result.ok) return setNotice({ kind: "error", text: result.error });
    onState(result.state);
    if (status !== "approved" && dirty && !(await persist())) return;
    setBeforeRewrite(null);
    const done = {
      approved: "Approved. Click Publish to website when you're ready.",
      hidden: "Hidden. It won't appear on the website.",
      review: "Moved back to To review.",
    };
    setNotice({ kind: "ok", text: done[status] });
  }

  async function summarize() {
    if (meeting.flags.some((f) => f.code === "low-content")) {
      if (!window.confirm("This looks like a test or an empty recording.\n\nWrite a summary anyway?")) return;
    }
    const result = await runJob("summary", () => api.summarize(meeting.id, draft, { retranscribe }));
    setRetranscribe(false);
    // The transcript on file may have changed even when the job stopped part way.
    onState(result.state || (await api.getState()));
    if (!result.ok) {
      if (result.cancelled) return setNotice({ kind: "ok", text: "Cancelled." });
      return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    }
    // The fields are locked while Claude works, so `fields` is still current here.
    if (!needsSummary) setBeforeRewrite(fields);
    setFields({ ...fields, overview: result.suggestion.overview, details: result.suggestion.details });
    setNotice({
      kind: "ok",
      text:
        "Claude's summary is in the overview and full summary. Check it against the video and agenda, edit as needed, then save or approve." +
        (result.agendaUsed ? "" : " No agenda was posted for this meeting, so item numbers and amounts come from the recording alone."),
    });
  }

  return (
    <div className="summary-panel">
      {meeting.conflict && (
        <div className="conflict" role="alert">
          <p>
            <strong>Another computer published a different version of this meeting</strong>
            {meeting.conflict.website ? "." : ": it was removed from the website."} Choose which one to keep. Nothing
            publishes until you do.
          </p>
          {meeting.conflict.website && (
            <details>
              <summary>See the version on the website</summary>
              <pre>{[meeting.conflict.website.overview, meeting.conflict.website.details].join("\n\n")}</pre>
            </details>
          )}
          <div className="conflict-actions">
            <button onClick={() => resolve("website")} disabled={busy}>
              {meeting.conflict.website ? "Use the website version" : "Accept the removal"}
            </button>
            <button className="primary" onClick={() => resolve("mine")} disabled={busy}>
              Keep my version
            </button>
          </div>
        </div>
      )}

      {needsSummary && !busy && (
        <p className="callout">
          No summary yet. Click <strong>Write summary with Claude</strong> below. The first time takes about 5 to 15
          minutes: the app downloads the video from Swagit, transcribes it, reads the posted agenda, then writes the
          summary. Leave the window open. If a transcript is already on file, it takes a minute or two.
        </p>
      )}

      <div className="editor-grid">
        <fieldset className="fields" disabled={busy}>
          <label>
            Meeting date
            <input type="date" value={fields.date} onChange={set("date")} />
          </label>
          <label>
            Meeting type
            <input value={fields.title} onChange={set("title")} />
          </label>
          <label>
            Overview <span className="muted">(always visible; one or two short sentences)</span>
            <WordCount text={fields.overview} limit={OVERVIEW_WORDS} />
            <textarea rows={5} value={fields.overview} onChange={set("overview")} />
          </label>
          <label>
            Full summary <span className="muted">(shown under "Read the full summary")</span>
            <WordCount text={fields.details} limit={DETAILS_WORDS} />
            <textarea className="tall" rows={16} value={fields.details} onChange={set("details")} />
          </label>
          <p className="hint">
            Formatting: <code>### Heading</code>, <code>- bullet</code>, <code>1. numbered</code>, <code>**bold**</code>
          </p>
          <label>
            Video link
            <input value={fields.recordingUrl} onChange={set("recordingUrl")} placeholder="https://…" />
          </label>
          <p className="hint">
            {meeting.transcript
              ? `Transcript on file (saved ${savedOn(meeting.transcript.savedAt)}). It is reused when Claude writes.`
              : "No transcript yet. One is saved the first time a summary, transcript or minutes are made, then reused."}
          </p>
        </fieldset>

        <div className="preview pane">
          <p className="preview-label pane-head">How it will look on the website</p>
          <Preview draft={draft} />
        </div>
      </div>

      <footer className="editor-actions">
        <button className={needsSummary ? "primary ai" : "ai"} onClick={summarize} disabled={busy}>
          <Sparkle />
          {needsSummary ? "Write summary with Claude" : "Rewrite with Claude"}
        </button>
        {meeting.transcript && (
          <label className="inline">
            <input
              type="checkbox"
              checked={retranscribe}
              onChange={(e) => setRetranscribe(e.target.checked)}
              disabled={busy}
            />
            Transcribe again
          </label>
        )}
        {beforeRewrite && (
          <button
            onClick={() => {
              setFields(beforeRewrite);
              setBeforeRewrite(null);
            }}
          >
            Undo rewrite
          </button>
        )}
        <span className="spacer" />
        <button onClick={save} disabled={!dirty || busy}>
          Save changes
        </button>
        {meeting.status !== "review" && (
          <button onClick={() => setStatus("review")} disabled={busy}>
            Move back to review
          </button>
        )}
        {meeting.status !== "hidden" && (
          <button onClick={() => setStatus("hidden")} disabled={busy}>
            Hide
          </button>
        )}
        {(meeting.status !== "approved" || dirty) && (
          <button className={needsSummary ? "" : "primary"} onClick={() => setStatus("approved")} disabled={busy}>
            {meeting.status === "approved" ? "Save and keep approved" : "Approve"}
          </button>
        )}
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------- Transcript */

/** The saved transcript, with search. Each timestamp opens the Swagit player at that moment. */
function TranscriptPanel({ meeting, active, busy, runJob, onState, setNotice }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(true);
  const fileKey = meeting.transcript ? `${meeting.transcript.name}|${meeting.transcript.savedAt}` : "";

  useEffect(() => {
    if (!fileKey) {
      setDoc(null);
      setError("");
      return undefined;
    }
    if (!active) return undefined;
    let live = true;
    api.readTranscript(meeting.id).then((res) => {
      if (!live) return;
      if (res.ok) setDoc({ ...res, items: parseTranscript(res.body) });
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [meeting.id, fileKey, active]);

  async function transcribe(retranscribe) {
    if (retranscribe && !window.confirm("Transcribe this meeting again? The saved transcript will be replaced and Deepgram charges for the new one.")) return;
    const result = await runJob("transcript", () => api.createTranscript(meeting.id, { retranscribe }));
    onState(result.state || (await api.getState()));
    if (!result.ok) {
      if (result.cancelled) return setNotice({ kind: "ok", text: "Cancelled." });
      return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    }
    setNotice({
      kind: "ok",
      text: result.transcriptReused
        ? "A transcript was already on file, so it was reused."
        : `Transcript saved${result.name ? ` as ${result.name}` : ""}.`,
    });
  }

  const q = query.trim().toLowerCase();
  const matches = (it) => it.text.toLowerCase().includes(q);
  const count = doc && q ? doc.items.filter(matches).length : 0;
  const shown = doc ? (q && onlyMatches ? doc.items.filter(matches) : doc.items) : [];
  const clipId = (doc && doc.clipId) || meeting.clipId;
  const playBase = doc && doc.playBase;
  const watchAt = (sec) => {
    const url = playUrlFor(clipId, sec ? Math.max(0, sec - 3) : 0, playBase);
    if (url) api.openExternal(url);
  };

  if (!meeting.transcript) {
    return (
      <div className="panel-body">
        <div className="callout stack">
          <p>
            <strong>No transcript yet.</strong> The app can transcribe this meeting on its own, without writing a
            summary or minutes. It downloads the video from Swagit and sends the audio to Deepgram, which takes about 5
            to 15 minutes and costs about $0.40 for a 90-minute meeting. The transcript is saved in Documents\Oro
            Valley Minutes\Transcripts and reused by every other step.
          </p>
          <div className="row">
            <button className="primary" onClick={() => transcribe(false)} disabled={busy || !meeting.clipId}>
              Transcribe now
            </button>
            {!meeting.clipId && <span className="muted">This meeting has no Swagit video.</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-body transcript-panel">
      <p className="hint">
        "Speaker" numbers are automatic and do not identify people. Click a time to watch that moment on Swagit.
        {doc && doc.name ? ` File: ${doc.name}` : ""}
      </p>
      {error && <p className="error">{error}</p>}
      {!doc && !error && <p className="muted">Loading…</p>}
      {doc && (
        <>
          <div className="transcript-toolbar">
            <div className="search-field search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search this transcript…"
                aria-label="Search this transcript"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {q && (
              <label className="inline">
                <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
                Only matching ({count})
              </label>
            )}
            <span className="spacer" />
            {clipId && <button onClick={() => watchAt(0)}>Watch on Swagit</button>}
            <button onClick={() => api.openTranscript(meeting.id)}>Open in Notepad</button>
            <button onClick={() => api.showTranscriptInFolder(meeting.id)}>Show in folder</button>
            <button onClick={() => transcribe(true)} disabled={busy}>
              Transcribe again
            </button>
          </div>
          <details className="transcript-details">
            <summary>About this transcript</summary>
            <div className="transcript-header">
              {doc.header.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </details>
          <div className="transcript-body">
            {shown.length === 0 && <p className="muted">No lines match “{query.trim()}”.</p>}
            {shown.map((it, i) =>
              it.kind === "turn" ? (
                <div key={i} className="turn">
                  <button
                    className="turn-time"
                    title={clipId ? "Watch from here on Swagit" : ""}
                    onClick={() => watchAt(it.sec)}
                    disabled={!clipId}
                  >
                    {it.time}
                  </button>
                  <div className="turn-body">
                    <span className={`turn-speaker ${speakerClass(it.speaker)}`}>{it.speaker}</span>
                    <p>
                      <Highlight text={it.text} query={q} />
                    </p>
                  </div>
                </div>
              ) : (
                <div key={i} className="turn-note">
                  <Highlight text={it.text} query={q} />
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Minutes */

function MinutesPanel({ meeting, busy, runJob, onState, setNotice, onDirty }) {
  const [doc, setDoc] = useState(null); // { markdown, notes, savedAt, name } once a draft is on file
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [beforeRedraft, setBeforeRedraft] = useState(null);
  const [retranscribe, setRetranscribe] = useState(false);
  const [checked, setChecked] = useState({});
  const [compare, setCompare] = useState(null); // { loading, text, error, url }
  const dirty = doc ? text !== doc.markdown : text.trim() !== "";
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const fileKey = meeting.minutes ? `${meeting.minutes.name}|${meeting.minutes.savedAt}` : "";
  const s = meeting.source || {};

  useEffect(() => onDirty("minutes", dirty), [dirty, onDirty]);

  // Load the saved draft (a local file, so it is cheap) unless the clerk is mid-edit.
  useEffect(() => {
    if (!fileKey || dirtyRef.current) return undefined;
    let live = true;
    api.readMinutes(meeting.id).then((res) => {
      if (!live) return;
      if (res.ok) {
        setDoc({ markdown: res.markdown, notes: res.notes, savedAt: res.savedAt, name: res.name });
        setText(res.markdown);
        setLoadError("");
      } else if (!res.none) {
        setLoadError(res.error);
      }
    });
    return () => {
      live = false;
    };
  }, [meeting.id, fileKey]);

  const html = useMemo(() => renderMarkdown(text), [text]);

  async function draft() {
    const redraft = Boolean(doc);
    if (redraft && !window.confirm(
      "Ask Claude to draft these minutes again? Your current text is sent along as the starting point, and the new draft replaces it in the editor. Undo redraft brings your text back."
    )) return;
    const result = await runJob("minutes", () => api.draftMinutes(meeting.id, redraft ? text : "", { retranscribe }));
    setRetranscribe(false);
    onState(result.state || (await api.getState()));
    if (!result.ok) {
      if (result.cancelled) return setNotice({ kind: "ok", text: "Cancelled." });
      return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    }
    if (redraft) setBeforeRedraft(text);
    setDoc({
      markdown: result.minutes,
      notes: result.notes || [],
      savedAt: new Date().toISOString(),
      name: result.savedPath ? baseName(result.savedPath) : doc ? doc.name : "",
    });
    setText(result.minutes);
    setChecked({});
    const caveats = [
      result.agendaUsed ? "" : "No agenda was posted, so item titles come from the recording alone.",
      result.sampleUsed ? "" : "No sample minutes were found, so the format is Claude's best guess.",
    ].filter(Boolean);
    setNotice({
      kind: "ok",
      text: `Claude's draft minutes are in the editor and saved to Documents\\Oro Valley Minutes. Read the reviewer notes, check the motions and votes against the video, and edit as needed. ${caveats.join(" ")}`.trim(),
    });
  }

  async function save() {
    const result = await api.saveMinutes(meeting.id, text);
    if (!result.ok) return setNotice({ kind: "error", text: result.error });
    setDoc({ ...(doc || { notes: [] }), markdown: text, savedAt: result.savedAt, name: result.name });
    setBeforeRedraft(null);
    onState(result.state);
    setNotice({ kind: "ok", text: `Draft minutes saved as ${result.name}.` });
  }

  async function exportAs(format) {
    const labels = { docx: "Word document", txt: "text file", md: "markdown file" };
    const result = await api.exportMinutes(meeting.id, format, text);
    if (result.cancelled) return;
    if (!result.ok) return setNotice({ kind: "error", text: result.error });
    setNotice({ kind: "ok", text: `Saved the ${labels[format]} to ${result.path}.` });
  }

  async function copy() {
    await api.writeClipboard(text);
    setNotice({ kind: "ok", text: "Copied the draft minutes to the clipboard." });
  }

  async function showPublished() {
    setCompare({ loading: true });
    const result = await api.publishedMinutes(meeting.id);
    if (!result.ok) return setCompare({ error: result.error });
    setCompare({ text: result.text, url: result.url });
  }

  const draftButton = (primary) => (
    <button className={primary ? "primary ai" : "ai"} onClick={draft} disabled={busy || !meeting.clipId}>
      <Sparkle />
      {doc ? "Redraft with Claude" : "Draft minutes with Claude"}
    </button>
  );

  if (!doc) {
    return (
      <div className="panel-body">
        {loadError && <p className="error">{loadError}</p>}
        <div className="callout stack">
          <p>
            <strong>No draft minutes yet.</strong> Claude can write a first draft in the Town's minutes format from the
            transcript and the posted agenda, including motions, votes, and who spoke. The first time takes about 5 to
            15 minutes: the app downloads the video from Swagit, transcribes it, reads the agenda, then writes the
            minutes. If a transcript is already on file, it takes a few minutes. The draft is saved in Documents\Oro
            Valley Minutes\Minutes. It is a starting point for the Clerk, not official minutes.
          </p>
          <div className="row">
            {draftButton(true)}
            {meeting.transcript && (
              <label className="inline">
                <input
                  type="checkbox"
                  checked={retranscribe}
                  onChange={(e) => setRetranscribe(e.target.checked)}
                  disabled={busy}
                />
                Transcribe again first
              </label>
            )}
            {!meeting.clipId && <span className="muted">This meeting has no Swagit video.</span>}
          </div>
        </div>
        {s.minutesUrl && (
          <p className="hint">
            The Town has already posted official minutes for this meeting: <Link url={s.minutesUrl}>open them</Link>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel-body minutes-panel">
      <div className="minutes-status">
        <span>
          {doc.name ? `${doc.name} · ` : ""}
          {dirty ? "Unsaved changes" : doc.savedAt ? `Saved ${savedAtTime(doc.savedAt)}` : "Saved"}
        </span>
        <span className="spacer" />
        <span className="muted">Formatting: <code>## Heading</code>, <code>- bullet</code>, <code>**bold**</code></span>
      </div>

      {doc.notes && doc.notes.length > 0 && (
        <div className="notes" role="region" aria-label="Reviewer notes from Claude">
          <p className="notes-title">
            <Sparkle />
            <span>
              <strong>Reviewer notes from Claude</strong> — things to check before these minutes are used.
            </span>
          </p>
          <ul>
            {doc.notes.map((note, i) => (
              <li key={i}>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[i])}
                    onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })}
                  />
                  <span className={checked[i] ? "done" : ""}>{note}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="minutes-grid">
        <label className="minutes-editor pane">
          <span className="pane-head">Draft minutes (edit here)</span>
          <textarea
            className="tall minutes-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            spellCheck
          />
        </label>
        <div className="minutes-preview-wrap pane">
          <p className="preview-label pane-head">How it reads</p>
          <div className="minutes-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>

      <footer className="editor-actions">
        {draftButton(false)}
        {meeting.transcript && (
          <label className="inline">
            <input
              type="checkbox"
              checked={retranscribe}
              onChange={(e) => setRetranscribe(e.target.checked)}
              disabled={busy}
            />
            Transcribe again
          </label>
        )}
        {beforeRedraft && (
          <button
            onClick={() => {
              setText(beforeRedraft);
              setBeforeRedraft(null);
            }}
            disabled={busy}
          >
            Undo redraft
          </button>
        )}
        <span className="spacer" />
        {s.minutesSeq && (
          <button onClick={showPublished} disabled={busy}>
            Compare with published minutes
          </button>
        )}
        <button onClick={() => exportAs("docx")} disabled={busy}>
          Export to Word (.docx)
        </button>
        <button onClick={() => exportAs("txt")} disabled={busy}>
          Export as text
        </button>
        <button onClick={copy} disabled={busy}>
          Copy to clipboard
        </button>
        <button onClick={() => api.showMinutesInFolder(meeting.id)} disabled={busy}>
          Open in folder
        </button>
        <button className="primary" onClick={save} disabled={!dirty || busy}>
          Save draft
        </button>
      </footer>

      {compare && (
        <Drawer
          title="Published minutes"
          subtitle="The Town's official minutes, as posted on the agenda system."
          onClose={() => setCompare(null)}
        >
          {compare.loading && <p className="muted">Loading the posted minutes…</p>}
          {compare.error && <p className="error">{compare.error}</p>}
          {compare.text && (
            <>
              {compare.url && (
                <p className="hint">
                  <Link url={compare.url}>Open the posted minutes in the browser</Link>
                </p>
              )}
              <pre className="published-text">{compare.text}</pre>
            </>
          )}
        </Drawer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Agenda */

function AgendaPanel({ meeting, active }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const s = meeting.source || {};

  async function load() {
    setLoading(true);
    setError("");
    const res = await api.readAgenda(meeting.id);
    setLoading(false);
    if (res.ok) setData(res);
    else setError(res.error || "The agenda could not be loaded.");
  }

  useEffect(() => {
    if (active && !data && !loading && !error) load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const agenda = data && data.agenda;
  const chapters = (data && data.index) || [];
  const clipId = (data && data.clipId) || meeting.clipId;
  const playAt = (sec) => {
    const url = playUrlFor(clipId, sec, data && data.playBase);
    if (url) api.openExternal(url);
  };

  return (
    <div className="panel-body agenda-panel">
      <div className="row">
        <p className="hint grow">
          The agenda comes from the Town's agenda system; the chapters come from the Swagit video. Click a time to
          watch that item.
        </p>
        <button onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && !data && <p className="muted">Loading the posted agenda…</p>}

      <div className="agenda-grid">
        <section aria-label="Posted agenda">
          <h3>Posted agenda</h3>
          {data && !agenda && (
            <p className="muted">
              {data.agendaError
                ? `The agenda could not be read (${data.agendaError}).`
                : "Not posted yet. The Town usually posts the agenda the week before the meeting."}
              {s.agendaUrl && (
                <>
                  {" "}
                  <Link url={s.agendaUrl}>Open the agenda page</Link>
                </>
              )}
            </p>
          )}
          {agenda && (
            <>
              <p className="agenda-meta">
                {[agenda.title, formatDate(agenda.date), agenda.time].filter(Boolean).join(" · ")}
                {agenda.amended && <span className="pill pill-review">Amended</span>}
              </p>
              <p className="agenda-links">
                {s.agendaUrl && <Link url={s.agendaUrl}>Open the posted agenda</Link>}
                {agenda.packetUrl && (
                  <>
                    {s.agendaUrl ? " · " : ""}
                    <Link url={agenda.packetUrl}>Agenda packet (PDF)</Link>
                  </>
                )}
              </p>
              {agenda.items && agenda.items.length > 0 ? (
                <ol className="agenda-items">
                  {agenda.items.map((it, i) => (
                    <li key={i} className={`level-${Math.min(3, Number(it.level) || 0)}`}>
                      {it.number && <span className="agenda-number">{it.number}</span>}
                      <span className="agenda-text">{it.text}</span>
                      {it.memoUrl && (
                        <>
                          {" "}
                          <Link url={it.memoUrl}>Staff report</Link>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              ) : agenda.agendaText ? (
                <pre className="agenda-text-block">{agenda.agendaText}</pre>
              ) : (
                <p className="muted">The posted agenda has no items.</p>
              )}
            </>
          )}
        </section>

        <section aria-label="Video chapters">
          <h3>Video chapters</h3>
          {data && chapters.length === 0 && (
            <p className="muted">
              Swagit has no chapter list for this video yet.
              {clipId && (
                <>
                  {" "}
                  <Link url={playUrlFor(clipId, 0)}>Watch on Swagit</Link>
                </>
              )}
            </p>
          )}
          {chapters.length > 0 && (
            <ul className="chapters">
              {chapters.map((ch, i) => (
                <li key={ch.id || i} className={`level-${Math.min(3, Number(ch.level) || 0)}`}>
                  <button className="turn-time" onClick={() => playAt(ch.start)} title="Watch from here on Swagit">
                    {formatSeconds(ch.start)}
                  </button>
                  <span className="chapter-title">{ch.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Meeting view */

function MeetingView({ meeting, onState, setNotice, busy, setBusy, onDirty, progress }) {
  const [view, setView] = useState("summary");
  const [job, setJob] = useState(null); // "summary" | "transcript" | "minutes" while one runs
  const [cancelling, setCancelling] = useState(false);
  const s = meeting.source || {};

  async function runJob(kind, work) {
    setBusy(true);
    setJob(kind);
    setCancelling(false);
    setNotice(null);
    try {
      return await work();
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    } finally {
      setBusy(false);
      setJob(null);
      setCancelling(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    await api.cancel();
  }

  const meta = [s.body && s.body !== s.title ? s.body : "", s.time, s.durationLabel].filter(Boolean).join(" · ");
  const has = {
    summary: Boolean(meeting.draft.overview),
    transcript: Boolean(meeting.transcript),
    minutes: Boolean(meeting.minutes),
    agenda: Boolean(s.agendaUrl),
  };

  return (
    <section className="editor" aria-label="Meeting">
      <header className="dash-head">
        <div className="dash-title">
          <h2>{formatDate(meeting.draft.date) || "Date needed"}</h2>
          <p className="dash-sub">
            <strong>{s.title || meeting.draft.title}</strong>
            {meta ? ` · ${meta}` : ""}
          </p>
          <p className="dash-links">
            {s.playerUrl ? <Link url={s.playerUrl}>Watch on Swagit</Link> : <span className="muted">No video link</span>}
            {" · "}
            {s.agendaUrl ? <Link url={s.agendaUrl}>Posted agenda</Link> : <span className="muted">No agenda posted</span>}
            {s.minutesUrl && (
              <>
                {" · "}
                <Link url={s.minutesUrl}>Official minutes</Link>
              </>
            )}
          </p>
        </div>
        <div className="head-right">
          <span className={`pill pill-${meeting.status}`}>{STATUS_LABELS[meeting.status]}</span>
          {meeting.onWebsite && <span className="pill pill-live">On the website</span>}
        </div>
      </header>

      {meeting.flags.length > 0 && (
        <ul className="flags">
          {meeting.flags.map((f) => (
            <li key={f.code}>{f.message}</li>
          ))}
        </ul>
      )}

      {meeting.conflict && view !== "summary" && (
        <p className="callout callout-error" role="alert">
          Another computer published a different version of this meeting's summary.{" "}
          <button className="link-button" onClick={() => setView("summary")}>
            Open the Summary tab to choose which one to keep.
          </button>
        </p>
      )}

      {job && (
        <div className="working" role="status">
          <div className="working-bar" aria-hidden="true">
            <span className="working-bar-fill" />
          </div>
          <div className="working-row">
            <span className="spinner" aria-hidden="true" />
            <span className="text">
              {cancelling ? "Cancelling…" : progress || `${JOB_LABELS[job] || "Working"}…`}
            </span>
            <button onClick={cancel} disabled={cancelling}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="view-tabs" role="tablist" aria-label="Meeting views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            aria-controls={`panel-${v.key}`}
            className={view === v.key ? "view-tab active" : "view-tab"}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {has[v.key] && <span className="tab-dot" aria-label="on file" />}
          </button>
        ))}
      </div>

      <div id="panel-summary" role="tabpanel" hidden={view !== "summary"}>
        <SummaryPanel meeting={meeting} onState={onState} setNotice={setNotice} busy={busy} runJob={runJob} onDirty={onDirty} />
      </div>
      <div id="panel-transcript" role="tabpanel" hidden={view !== "transcript"}>
        <TranscriptPanel
          meeting={meeting}
          active={view === "transcript"}
          busy={busy}
          runJob={runJob}
          onState={onState}
          setNotice={setNotice}
        />
      </div>
      <div id="panel-minutes" role="tabpanel" hidden={view !== "minutes"}>
        <MinutesPanel meeting={meeting} busy={busy} runJob={runJob} onState={onState} setNotice={setNotice} onDirty={onDirty} />
      </div>
      <div id="panel-agenda" role="tabpanel" hidden={view !== "agenda"}>
        <AgendaPanel meeting={meeting} active={view === "agenda"} />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- App */

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("review");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const dirtyRef = useRef({});
  const onDirty = useRef((kind, value) => {
    dirtyRef.current = { ...dirtyRef.current, [kind]: value };
  }).current;

  useEffect(() => {
    api.getState().then(setState);
    return api.onProgress(setProgress);
  }, []);

  if (!state) return null;

  const byTab = (status) => state.meetings.filter((m) => m.status === status);
  const q = query.trim().toLowerCase();
  const matchesQuery = (m) =>
    !q ||
    `${shortDate(m.draft.date)} ${m.draft.date || ""} ${m.source.title || ""} ${m.source.body || ""} ${m.draft.title || ""}`
      .toLowerCase()
      .includes(q);
  const list = byTab(tab).filter(matchesQuery);
  const selected = state.meetings.find((m) => m.id === selectedId) || null;
  const settings = state.settings;
  const missing = [
    !settings.hasAnthropicApiKey && "the Anthropic API key",
    !settings.hasDeepgramApiKey && "the Deepgram API key",
    !settings.hasGithubToken && "the GitHub token",
  ].filter(Boolean);
  const canPublish = settings.hasGithubToken && state.pendingCount > 0 && !busy;

  async function refresh() {
    setBusy(true);
    setNotice(null);
    const result = await api.refresh();
    setBusy(false);
    if (!result.ok) return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    setState(result.state);
    if (result.publishError) return setNotice({ kind: "error", text: result.publishError, settings: true });
    setNotice({
      kind: "ok",
      text: result.added
        ? `Loaded ${result.added} new meeting video${result.added === 1 ? "" : "s"} from Swagit.`
        : "No new meeting videos on Swagit.",
    });
  }

  async function publish() {
    const changes = state.meetings.filter((m) => m.pending);
    const lines = changes.map((m) => `• ${shortDate(m.draft.date)}: ${PENDING_LABELS[m.pending]}`);
    if (!window.confirm(`Publish these summary changes to the Town website?\n\n${lines.join("\n")}`)) return;
    setBusy(true);
    const result = await api.publish();
    setBusy(false);
    if (!result.ok) return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    setState(result.state);
    setNotice({
      kind: "ok",
      text: "Published. The website updates within a few minutes.",
      link: settings.widgetUrl,
    });
  }

  function select(id) {
    if (id === selectedId || busy) return;
    const parts = [dirtyRef.current.summary && "summary", dirtyRef.current.minutes && "draft minutes"].filter(Boolean);
    if (parts.length && !window.confirm(`You have unsaved changes to this meeting's ${parts.join(" and ")}. Discard them?`)) return;
    dirtyRef.current = {};
    setSelectedId(id);
    setNotice(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <Mark />
        <div className="topbar-title">
          <h1>Oro Valley Council Dashboard</h1>
          <span className="topbar-caption">Town Clerk · staff tool</span>
        </div>
        <span className="progress" aria-live="polite">
          {progress}
        </span>
        <div className="topbar-actions">
          <button onClick={refresh} disabled={busy}>
            Check for new meetings
          </button>
          <button className={canPublish ? "primary" : ""} onClick={publish} disabled={!canPublish}>
            Publish to website{state.pendingCount ? ` (${state.pendingCount})` : ""}
          </button>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      {missing.length > 0 && (
        <p className="banner">
          <BannerIcon kind="warn" />
          <span className="banner-text">
            Setup isn't finished on this computer. Add {missing.join(", ")} in Settings.{" "}
            <button className="link-button" onClick={() => setShowSettings(true)}>
              Open Settings
            </button>
          </span>
        </p>
      )}
      {notice && (
        <p className={`banner banner-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <BannerIcon kind={notice.kind} />
          <span className="banner-text">
            {notice.text}{" "}
            {notice.settings && (
              <button className="link-button" onClick={() => setShowSettings(true)}>
                Open Settings
              </button>
            )}
            {notice.link && (
              <button className="link-button" onClick={() => api.openExternal(notice.link)}>
                View the widget
              </button>
            )}
          </span>
        </p>
      )}

      <div className="main">
        <nav className="sidebar" aria-label="Meetings">
          <div className="sidebar-head">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.status}
                  role="tab"
                  aria-selected={tab === t.status}
                  className={tab === t.status ? "tab active" : "tab"}
                  onClick={() => setTab(t.status)}
                >
                  {t.label} <span className="count">{byTab(t.status).length}</span>
                </button>
              ))}
            </div>
            {state.meetings.length > 0 && (
              <div className="search-field sidebar-search-wrap">
                <SearchIcon />
                <input
                  className="sidebar-search"
                  type="search"
                  placeholder="Search by date or name…"
                  aria-label="Search meetings"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
          </div>
          {list.length === 0 && (
            <p className="empty">
              {state.meetings.length === 0
                ? "Click Check for new meetings to load meeting videos from Swagit."
                : q
                  ? "No meetings match."
                  : "Nothing here."}
            </p>
          )}
          <ul className="meeting-list">
            {list.map((m) => {
              const src = m.source || {};
              const meta = [src.body && src.body !== src.title ? src.body : "", src.durationLabel].filter(Boolean).join(" · ");
              return (
                <li key={m.id}>
                  <button className={m.id === selectedId ? "meeting active" : "meeting"} onClick={() => select(m.id)}>
                    <span className="meeting-date">{shortDate(m.draft.date)}</span>
                    <span className="meeting-title">{src.title || m.draft.title}</span>
                    {meta && <span className="meeting-meta">{meta}</span>}
                    <span className="meeting-badges">
                      {m.conflict && <span className="badge badge-conflict">Choose a version</span>}
                      {m.flags.length > 0 && !m.autoHidden && <span className="badge badge-warn">Check</span>}
                      {m.pending && <span className="badge badge-pending">{PENDING_LABELS[m.pending]}</span>}
                      {m.draft.overview && <span className="badge badge-doc">Summary</span>}
                      {m.transcript && <span className="badge badge-doc">Transcript</span>}
                      {m.minutes && <span className="badge badge-doc">Minutes draft</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {selected ? (
          <MeetingView
            key={selected.id}
            meeting={selected}
            onState={setState}
            setNotice={setNotice}
            busy={busy}
            setBusy={setBusy}
            onDirty={onDirty}
            progress={progress}
          />
        ) : (
          <section className="editor editor-empty">
            <div className="empty-state">
              <Mark size={56} />
              <p>Choose a meeting on the left to see its summary, transcript, draft minutes, and agenda.</p>
            </div>
          </section>
        )}
      </div>

      {showSettings && (
        <Settings
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(next, stayOpen) => {
            setState(next);
            if (!stayOpen) {
              setShowSettings(false);
              setNotice({ kind: "ok", text: "Settings saved." });
            }
          }}
        />
      )}
    </div>
  );
}

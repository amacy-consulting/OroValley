import { useEffect, useMemo, useRef, useState } from "react";
import { latestHtml } from "../../../../../widget/render.js";
import widgetCss from "../../../../../widget/widget.css?raw";
import { api } from "../../api.js";
import { fieldsOf, hasSummary, savedOn, STATUS_LABELS } from "../../util.js";
import { Sparkle } from "../../components/icons.jsx";
import { WordCount } from "../../components/ui.jsx";

// Length targets, matching what Claude is asked for.
const OVERVIEW_WORDS = 45;
const DETAILS_WORDS = 200;

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

export function SummaryPanel({ meeting, onState, setNotice, busy, runJob, onDirty }) {
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
  // another computer's published edit, or the bulk queue wrote a summary), follow it,
  // unless the reviewer has edits.
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
      approved: "Approved. Use Website › Publish to website when you're ready.",
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
            Overview <span className="muted">(one or two short sentences)</span>
            <WordCount text={fields.overview} limit={OVERVIEW_WORDS} />
            <textarea rows={5} value={fields.overview} onChange={set("overview")} />
          </label>
          <label>
            Full summary <span className="muted">(what was discussed and decided)</span>
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
          <p className="preview-label pane-head">Preview (as it would appear on the website)</p>
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
        <button onClick={save} disabled={!dirty || busy}>
          Save changes
        </button>
        <span className="spacer" />
        <div className="website-actions" role="group" aria-label="Website">
          <span className="section-label">Website</span>
          <span className={`pill pill-${meeting.status}`}>{STATUS_LABELS[meeting.status]}</span>
          {meeting.onWebsite && <span className="pill pill-live">On the website</span>}
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
        </div>
      </footer>
    </div>
  );
}

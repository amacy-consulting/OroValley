import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.js";
import { fieldsOf, hasSummary, savedOn } from "../../util.js";
import { Sparkle } from "../../components/icons.jsx";
import { WordCount } from "../../components/ui.jsx";

// Length targets, matching what Claude is asked for.
const OVERVIEW_WORDS = 45;
const DETAILS_WORDS = 200;

export function SummaryPanel({ meeting, onState, setNotice, busy, runJob, onDirty }) {
  const [fields, setFields] = useState(() => fieldsOf(meeting.draft));
  const [beforeRewrite, setBeforeRewrite] = useState(null);
  const [retranscribe, setRetranscribe] = useState(false);
  const saved = useMemo(() => fieldsOf(meeting.draft), [meeting.draft]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const draft = { ...meeting.draft, ...fields };
  const needsSummary = !hasSummary(fields);
  const hidden = meeting.status === "hidden";
  const set = (key) => (e) => {
    const value = e.target.value;
    setFields((f) => ({ ...f, [key]: value }));
  };

  useEffect(() => onDirty("summary", dirty), [dirty, onDirty]);

  // When the saved draft changes underneath (e.g. the bulk queue wrote a summary),
  // follow it, unless the reviewer has edits.
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

  async function setStatus(status) {
    const result = await api.setStatus(meeting.id, status);
    if (!result.ok) return setNotice({ kind: "error", text: result.error });
    onState(result.state);
    if (dirty && !(await persist())) return;
    setBeforeRewrite(null);
    setNotice({
      kind: "ok",
      text: status === "hidden" ? "Hidden. Find it under the Hidden tab." : "Back under Meetings.",
    });
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
        "Claude's summary is in the overview and full summary. Check it against the video and agenda, edit as needed, then save." +
        (result.agendaUsed ? "" : " No agenda was posted for this meeting, so item numbers and amounts come from the recording alone."),
    });
  }

  return (
    <div className="summary-panel">
      {needsSummary && !busy && (
        <p className="callout">
          No summary yet. Click <strong>Write summary with Claude</strong> below. The first time takes about 5 to 15
          minutes: the app downloads the video from Swagit, transcribes it, reads the posted agenda, then writes the
          summary. Leave the window open. If a transcript is already on file, it takes a minute or two.
        </p>
      )}

      <fieldset className="fields" disabled={busy}>
        <div className="field-row">
          <label className="ov-field">
            <span className="ov-label">Meeting date</span>
            <input className="ov-input" type="date" value={fields.date} onChange={set("date")} />
          </label>
          <label className="ov-field grow">
            <span className="ov-label">Meeting type</span>
            <input className="ov-input" value={fields.title} onChange={set("title")} />
          </label>
        </div>
        <label className="ov-field">
          <span className="ov-label">
            Overview <span className="muted">(one or two short sentences)</span>
            <WordCount text={fields.overview} limit={OVERVIEW_WORDS} />
          </span>
          <textarea className="ov-input" rows={4} value={fields.overview} onChange={set("overview")} />
        </label>
        <label className="ov-field">
          <span className="ov-label">
            Full summary <span className="muted">(what was discussed and decided)</span>
            <WordCount text={fields.details} limit={DETAILS_WORDS} />
          </span>
          <textarea className="ov-input tall" rows={16} value={fields.details} onChange={set("details")} />
        </label>
        <p className="hint">
          Formatting: <code>### Heading</code>, <code>- bullet</code>, <code>1. numbered</code>, <code>**bold**</code>
        </p>
        <label className="ov-field">
          <span className="ov-label">Video link</span>
          <input className="ov-input" value={fields.recordingUrl} onChange={set("recordingUrl")} placeholder="https://" />
        </label>
        <p className="hint">
          {meeting.transcript
            ? `Transcript on file (saved ${savedOn(meeting.transcript.savedAt)}). It is reused when Claude writes.`
            : "No transcript yet. One is saved the first time a summary, transcript or minutes are made, then reused."}
        </p>
        <p className="hint">Saved summaries are searchable from Search and are used when you Ask Claude.</p>
      </fieldset>

      <footer className="editor-actions">
        <button className={needsSummary ? "ov-btn ai" : "link-button ai"} onClick={summarize} disabled={busy}>
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
            className="link-button"
            onClick={() => {
              setFields(beforeRewrite);
              setBeforeRewrite(null);
            }}
          >
            Undo rewrite
          </button>
        )}
        <button className="link-button" onClick={save} disabled={!dirty || busy}>
          Save changes
        </button>
        <span className="spacer" />
        <button className="link-button" onClick={() => setStatus(hidden ? "active" : "hidden")} disabled={busy}>
          {hidden ? "Unhide" : "Hide this meeting"}
        </button>
      </footer>
    </div>
  );
}

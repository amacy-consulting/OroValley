import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "../../../../../widget/markdown.js";
import { api } from "../../api.js";
import { baseName, savedAtTime } from "../../util.js";
import { Sparkle } from "../../components/icons.jsx";
import { Drawer, Link } from "../../components/ui.jsx";

export function MinutesPanel({ meeting, busy, runJob, onState, setNotice, onDirty }) {
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
    <button className={primary ? "ov-btn ai" : "link-button ai"} onClick={draft} disabled={busy || !meeting.clipId}>
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
        <details className="notes ov-accordion" open role="region" aria-label="Reviewer notes from Claude">
          <summary className="notes-title ov-accordion-trigger">
            <Sparkle />
            <strong>Reviewer notes from Claude</strong>
          </summary>
          <div className="ov-accordion-body">
            <p className="hint">Things to check before these minutes are used.</p>
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
        </details>
      )}

      <div className="minutes-grid">
        <label className="minutes-editor pane">
          <span className="pane-head ov-sidebox-title">Draft minutes (edit here)</span>
          <textarea
            className="ov-input tall minutes-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            spellCheck
          />
        </label>
        <div className="minutes-preview-wrap pane">
          <p className="preview-label pane-head ov-sidebox-title">How it reads</p>
          <div className="minutes-preview ov-prose" dangerouslySetInnerHTML={{ __html: html }} />
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
            className="link-button"
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
          <button className="link-button" onClick={showPublished} disabled={busy}>
            Compare with published minutes
          </button>
        )}
        <button className="link-button" onClick={() => exportAs("docx")} disabled={busy}>
          Export to Word (.docx)
        </button>
        <button className="link-button" onClick={() => exportAs("txt")} disabled={busy}>
          Export as text
        </button>
        <button className="link-button" onClick={copy} disabled={busy}>
          Copy to clipboard
        </button>
        <button className="link-button" onClick={() => api.showMinutesInFolder(meeting.id)} disabled={busy}>
          Open in folder
        </button>
        <button className="ov-btn" onClick={save} disabled={!dirty || busy}>
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

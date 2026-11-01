import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { parseTranscript, speakerClass, playUrlFor } from "../../transcript.js";
import { talkTime } from "../../util.js";
import { SearchIcon } from "../../components/icons.jsx";
import { Highlight } from "../../components/ui.jsx";

/** The saved transcript, with search, a "Who spoke" strip and deep links from the
 *  other views (`scrollTo` = { sec, seq }). Each timestamp opens the Swagit player at that moment. */
export function TranscriptPanel({ meeting, active, busy, runJob, onState, setNotice, scrollTo, onSearchAll }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [speakers, setSpeakers] = useState([]);
  const [speaker, setSpeaker] = useState(null); // speaker label filter, or null
  const [target, setTarget] = useState(null); // index of the turn to highlight
  const bodyRef = useRef(null);
  const fileKey = meeting.transcript ? `${meeting.transcript.name}|${meeting.transcript.savedAt}` : "";

  useEffect(() => {
    if (!fileKey) {
      setDoc(null);
      setError("");
      setSpeakers([]);
      return undefined;
    }
    if (!active) return undefined;
    let live = true;
    api.readTranscript(meeting.id).then((res) => {
      if (!live) return;
      if (res.ok) setDoc({ ...res, items: parseTranscript(res.body) });
      else setError(res.error);
    });
    api.speakers(meeting.id).then((res) => {
      if (live && res && res.ok) setSpeakers(Array.isArray(res.speakers) ? res.speakers : []);
    });
    return () => {
      live = false;
    };
  }, [meeting.id, fileKey, active]);

  // A search hit or a citation asked for a moment in this transcript: land on that turn.
  useEffect(() => {
    if (!scrollTo || !doc || !active) return undefined;
    setQuery("");
    setSpeaker(null);
    const sec = Number(scrollTo.sec) || 0;
    let best = -1;
    doc.items.forEach((it, i) => {
      if (it.kind === "turn" && it.sec <= sec) best = i;
    });
    if (best < 0) best = doc.items.findIndex((it) => it.kind === "turn");
    if (best < 0) return undefined;
    setTarget(best);
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current && bodyRef.current.querySelector(`[data-index="${best}"]`);
      if (el) el.scrollIntoView({ block: "center" });
    });
    const timer = setTimeout(() => setTarget(null), 2600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [scrollTo, doc, active]);

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
  const matchesQuery = (it) => !q || it.text.toLowerCase().includes(q);
  const matchesSpeaker = (it) => !speaker || (it.kind === "turn" && it.speaker === speaker);
  const count = doc && q ? doc.items.filter((it) => matchesQuery(it) && matchesSpeaker(it)).length : 0;
  const keep = (it) => (!speaker || matchesSpeaker(it)) && (!(q && onlyMatches) || matchesQuery(it));
  const shown = doc ? doc.items.map((it, index) => ({ it, index })).filter(({ it }) => keep(it)) : [];
  const clipId = (doc && doc.clipId) || meeting.clipId;
  const playBase = doc && doc.playBase;
  const totalTalk = speakers.reduce((s, sp) => s + (Number(sp.seconds) || 0), 0);
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
            Valley Minutes\Transcripts, reused by every other step, and searchable from the Search view.
          </p>
          <div className="row">
            <button className="ov-btn" onClick={() => transcribe(false)} disabled={busy || !meeting.clipId}>
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
            <div className="ov-field search">
              <input
                className="ov-input"
                type="search"
                placeholder="Search this transcript"
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
            {q && onSearchAll && (
              <button className="link-button" onClick={() => onSearchAll(query.trim())}>
                Search all meetings for this
              </button>
            )}
            <span className="spacer" />
            {clipId && (
              <button className="link-button" onClick={() => watchAt(0)}>
                Watch on Swagit
              </button>
            )}
            <button className="link-button" onClick={() => api.openTranscript(meeting.id)}>
              Open in Notepad
            </button>
            <button className="link-button" onClick={() => api.showTranscriptInFolder(meeting.id)}>
              Show in folder
            </button>
            <button className="link-button" onClick={() => transcribe(true)} disabled={busy}>
              Transcribe again
            </button>
          </div>

          {speakers.length > 0 && (
            <div className="who-spoke ov-sidebox" role="group" aria-label="Who spoke">
              <p className="ov-sidebox-title">Who spoke</p>
              <div className="ov-sidebox-content">
              {speakers.map((sp) => {
                const share = totalTalk ? Math.round((100 * (Number(sp.seconds) || 0)) / totalTalk) : 0;
                const on = speaker === sp.speaker;
                return (
                  <button
                    key={sp.speaker}
                    className={`speaker-chip ${speakerClass(sp.speaker)}${on ? " on" : ""}`}
                    aria-pressed={on}
                    title={`${sp.turns} turns · ${sp.words} words · ${share}% of the talking`}
                    onClick={() => setSpeaker(on ? null : sp.speaker)}
                  >
                    <span className="speaker-name">{sp.speaker}</span>
                    <span className="speaker-time">{talkTime(sp.seconds)}</span>
                  </button>
                );
              })}
              {speaker && (
                <button className="link-button" onClick={() => setSpeaker(null)}>
                  Show everyone
                </button>
              )}
              </div>
            </div>
          )}

          <details className="transcript-details ov-sidebox">
            <summary className="ov-sidebox-title">About this transcript</summary>
            <div className="transcript-header ov-sidebox-content">
              {doc.header.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </details>
          <div className="transcript-body" ref={bodyRef}>
            {shown.length === 0 && (
              <p className="muted">
                {q ? `No lines match “${query.trim()}”${speaker ? ` for ${speaker}` : ""}.` : `No lines for ${speaker}.`}
              </p>
            )}
            {shown.map(({ it, index }) =>
              it.kind === "turn" ? (
                <div key={index} data-index={index} className={target === index ? "turn turn-target" : "turn"}>
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
                <div key={index} data-index={index} className="turn-note">
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

import { useEffect, useState } from "react";
import { formatDate } from "../../../../../widget/render.js";
import { api } from "../../api.js";
import { playUrlFor, formatSeconds } from "../../transcript.js";
import { Link } from "../../components/ui.jsx";

export function AgendaPanel({ meeting, active }) {
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

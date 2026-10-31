import { api } from "../api.js";
import { savedAtTime, shortDate } from "../util.js";
import { Drawer } from "./ui.jsx";

const KIND = { transcript: "Transcribe", summary: "Write summary", minutes: "Draft minutes" };

/** Running / pending / done, with Cancel all and Cancel one. */
export function QueueDrawer({ jobs, state, onClose, onOpenMeeting }) {
  const name = (id) => {
    const m = state.meetings.find((x) => x.id === id);
    return m ? `${shortDate(m.draft.date)} · ${m.source.title || m.draft.title}` : id;
  };
  const running = jobs.running;
  const pending = jobs.pending || [];
  const done = [...(jobs.done || [])].reverse();
  const active = Boolean(running) || pending.length > 0;

  return (
    <Drawer
      title="Work queue"
      subtitle={active ? `${pending.length + (running ? 1 : 0)} to go · one meeting at a time` : "Nothing running."}
      onClose={onClose}
      actions={active && <button onClick={() => api.cancelAllJobs()}>Cancel all</button>}
    >
      <section className="queue-section">
        <p className="section-label">Running</p>
        {running ? (
          <div className="queue-item running">
            <span className="spinner" aria-hidden="true" />
            <div className="queue-text">
              <button className="link-button" onClick={() => onOpenMeeting(running.meetingId)}>
                {name(running.meetingId)}
              </button>
              <span className="queue-kind">{KIND[running.kind] || running.kind}</span>
              <span className="muted queue-progress">{running.progress || "Starting…"}</span>
            </div>
            <button onClick={() => api.cancelJob(running.meetingId, running.kind)}>Cancel</button>
          </div>
        ) : (
          <p className="muted">—</p>
        )}
      </section>

      <section className="queue-section">
        <p className="section-label">Waiting ({pending.length})</p>
        {pending.length === 0 && <p className="muted">—</p>}
        <ul className="queue-list">
          {pending.map((j, i) => (
            <li key={`${j.meetingId}-${j.kind}-${i}`} className="queue-item">
              <span className="queue-n">{i + 1}</span>
              <div className="queue-text">
                <button className="link-button" onClick={() => onOpenMeeting(j.meetingId)}>
                  {name(j.meetingId)}
                </button>
                <span className="queue-kind">{KIND[j.kind] || j.kind}</span>
              </div>
              <button onClick={() => api.cancelJob(j.meetingId, j.kind)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="queue-section">
        <p className="section-label">Done ({done.length})</p>
        {done.length === 0 && <p className="muted">—</p>}
        <ul className="queue-list">
          {done.map((j, i) => (
            <li key={`${j.meetingId}-${j.kind}-${i}`} className={j.ok ? "queue-item ok" : "queue-item failed"}>
              <span className={j.ok ? "queue-mark ok" : "queue-mark failed"} aria-hidden="true">
                {j.ok ? "✓" : "!"}
              </span>
              <div className="queue-text">
                <button className="link-button" onClick={() => onOpenMeeting(j.meetingId)}>
                  {name(j.meetingId)}
                </button>
                <span className="queue-kind">
                  {KIND[j.kind] || j.kind}
                  {j.finishedAt ? ` · ${savedAtTime(j.finishedAt)}` : ""}
                </span>
                {!j.ok && <span className="error queue-error">{j.error || "Failed."}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}

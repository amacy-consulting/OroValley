import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../dates.js";
import { api } from "../api.js";
import { money, plural } from "../util.js";
import { Modal } from "./ui.jsx";

const BODY_CHOICES = [
  { key: "council", label: "Town Council", kinds: ["council", "special", "work-session"] },
  { key: "pz", label: "Planning & Zoning", kinds: ["pz"] },
  { key: "boards", label: "Boards & commissions", kinds: ["board", "other"] },
  { key: "all", label: "All bodies", kinds: "all" },
];

/** Bulk work: pick meetings, see the Deepgram estimate, add them to the queue. */
export function TranscribeDialog({ onClose, onQueued, settings, busy }) {
  const [monthsBack, setMonthsBack] = useState(12);
  const [body, setBody] = useState("council");
  const [summaries, setSummaries] = useState(false);
  const [minutes, setMinutes] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [checked, setChecked] = useState({});
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const needs = useMemo(() => ["transcript", ...(summaries ? ["summary"] : []), ...(minutes ? ["minutes"] : [])], [summaries, minutes]);

  useEffect(() => {
    let live = true;
    const choice = BODY_CHOICES.find((b) => b.key === body);
    api.candidates({ kinds: choice.kinds, monthsBack, needs }).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      setError("");
      setCandidates(res.candidates);
      // Everything without a transcript starts checked; the rest the reviewer picks.
      setChecked(Object.fromEntries(res.candidates.map((c) => [c.id, !c.has.transcript])));
    });
    return () => {
      live = false;
    };
  }, [monthsBack, body, needs]);

  const list = candidates || [];
  const picked = list.filter((c) => checked[c.id]);
  const cost = picked.reduce((s, c) => s + (c.estimatedCost || 0), 0);
  const toTranscribe = picked.filter((c) => !c.has.transcript).length;
  const unknown = picked.filter((c) => !c.has.transcript && !c.durationKnown).length;
  const jobCount = picked.reduce(
    (n, c) => n + (c.has.transcript ? 0 : 1) + (summaries && !c.has.summary ? 1 : 0) + (minutes && !c.has.minutes ? 1 : 0),
    0
  );
  const allChecked = list.length > 0 && picked.length === list.length;

  async function start() {
    const items = [];
    for (const c of picked) {
      if (!c.has.transcript) items.push({ meetingId: c.id, kind: "transcript" });
      if (summaries && !c.has.summary) items.push({ meetingId: c.id, kind: "summary" });
      if (minutes && !c.has.minutes) items.push({ meetingId: c.id, kind: "minutes" });
    }
    if (!items.length) return;
    setStarting(true);
    const res = await api.enqueueJobs(items);
    setStarting(false);
    if (!res.ok) return setError(res.error);
    onQueued(res);
  }

  const missingKeys = [
    toTranscribe > 0 && !settings.hasDeepgramApiKey && "the Deepgram API key",
    (summaries || minutes) && !settings.hasAnthropicApiKey && "the Anthropic API key",
  ].filter(Boolean);

  return (
    <Modal title="Transcribe meetings" titleId="transcribe-title" onClose={onClose} wide>
      <p className="hint modal-intro">
        Pick the meetings to transcribe. The app downloads each video from Swagit and sends the audio to Deepgram, one
        meeting at a time, and saves the transcripts in Documents\Oro Valley Minutes. You can keep using the app while
        it works.
      </p>

      <div className="row dialog-filters">
        <label className="inline">
          Last
          <select className="ov-input" value={monthsBack} onChange={(e) => setMonthsBack(Number(e.target.value))} aria-label="Months back">
            {[3, 6, 12, 24, 36].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          Body
          <select className="ov-input" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body">
            {BODY_CHOICES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <label className="inline">
          <input type="checkbox" checked={summaries} onChange={(e) => setSummaries(e.target.checked)} />
          Also write summaries
        </label>
        <label className="inline">
          <input type="checkbox" checked={minutes} onChange={(e) => setMinutes(e.target.checked)} />
          Also draft minutes
        </label>
      </div>
      {(summaries || minutes) && (
        <p className="hint">
          The AI model writes {summaries && minutes ? "a summary and a minutes draft" : summaries ? "a summary" : "a minutes draft"} for each
          picked meeting that lacks one; summaries are saved into the draft for you to review. The AI model's cost is billed
          to the Town's Anthropic workspace, roughly a few cents to a few dimes per meeting.
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {candidates === null && !error && <p className="muted">Looking through the meeting list…</p>}
      {candidates && list.length === 0 && (
        <p className="callout">
          Nothing to do: every {BODY_CHOICES.find((b) => b.key === body).label} meeting in the last {monthsBack} months already
          has {needs.length > 1 ? "all of these" : "a transcript"}. Widen the months or pick another body.
        </p>
      )}

      {list.length > 0 && (
        <div className="checklist-wrap ov-table-wrap">
          <table className="data-table ov-table compact checklist">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    aria-label="Select all"
                    onChange={(e) => setChecked(Object.fromEntries(list.map((c) => [c.id, e.target.checked])))}
                  />
                </th>
                <th>Date</th>
                <th>Meeting</th>
                <th>Length</th>
                <th>Needs</th>
                <th className="num">Deepgram</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={checked[c.id] ? "on" : ""}>
                  <td className="check">
                    <input
                      type="checkbox"
                      checked={Boolean(checked[c.id])}
                      aria-label={`${formatDate(c.date, "short")} ${c.title}`}
                      onChange={(e) => setChecked({ ...checked, [c.id]: e.target.checked })}
                    />
                  </td>
                  <td className="nowrap">{formatDate(c.date, "short")}</td>
                  <td>
                    {c.title}
                    {c.body && c.body !== c.title ? <span className="muted"> · {c.body}</span> : ""}
                  </td>
                  <td className="nowrap">{c.durationKnown ? c.durationLabel : <span className="muted">unknown (≈{c.estimatedMinutes} min)</span>}</td>
                  <td>
                    <span className="meeting-badges">
                      {c.missing.map((n) => (
                        <span key={n} className="badge badge-muted">
                          {n === "transcript" ? "No transcript" : n === "summary" ? "No summary" : "No minutes draft"}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num">{c.has.transcript ? <span className="muted">—</span> : money(c.estimatedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missingKeys.length > 0 && (
        <p className="error">Add {missingKeys.join(" and ")} in Settings before starting.</p>
      )}

      <div className="modal-actions estimate-row">
        <span className="estimate">
          {picked.length ? (
            <>
              <strong>{plural(picked.length, "meeting")}</strong> · {plural(jobCount, "job")} ·{" "}
              {toTranscribe ? `about ${money(cost)} on Deepgram` : "no Deepgram cost"}
              {unknown ? ` (${unknown} with unknown length, estimated at 150 min)` : ""}
            </>
          ) : (
            "Nothing selected."
          )}
        </span>
        <span className="spacer" />
        <button className="link-button" onClick={onClose}>
          Cancel
        </button>
        <button className="ov-btn" onClick={start} disabled={starting || !jobCount || busy || missingKeys.length > 0}>
          {busy ? "Another action is running" : `Start ${jobCount ? `(${jobCount})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../../../widget/render.js";
import { renderMarkdown } from "../../../../widget/markdown.js";
import { api } from "../api.js";
import { playUrlFor } from "../transcript.js";
import { BODY_OPTIONS, savedAtTime, shortDate } from "../util.js";
import { Sparkle } from "../components/icons.jsx";
import { Working } from "../components/ui.jsx";

const SCOPES = [
  { key: "all", label: "All meetings" },
  { key: "dates", label: "Date range" },
  { key: "council", label: "Only Town Council" },
  { key: "meeting", label: "Specific meeting" },
];

/** Turn "[3]" markers in the rendered answer into citation chips. Runs on the
 *  renderer's escaped HTML, so the only "[n]" left are the ones in the answer text. */
function withCitationChips(html, citations) {
  const known = new Set((citations || []).map((c) => Number(c.n)));
  return html.replace(/\[(\d{1,2})\]/g, (m, n) =>
    known.has(Number(n))
      ? `<button type="button" class="cite-chip" data-n="${n}" aria-label="Source ${n}">${n}</button>`
      : m
  );
}

function scopeLabel(scope) {
  if (!scope) return "All meetings";
  if (scope.meetingIds && scope.meetingIds.length) return "One meeting";
  if (scope.bodies && scope.bodies.length) return "Town Council";
  if (scope.from || scope.to) return [scope.from, scope.to].filter(Boolean).map((d) => formatDate(d, "short")).join(" – ");
  return "All meetings";
}

export function Ask({ active, state, busy, setBusy, progress, go, setNotice }) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null); // { id, question, answer, citations, askedAt, scope }
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [flash, setFlash] = useState(null); // citation n to highlight
  const answerRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    api.askHistory().then((res) => res && res.ok && setHistory(res.asks || []));
    if (textareaRef.current && !current) textareaRef.current.focus();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const withTranscript = useMemo(() => state.meetings.filter((m) => m.transcript), [state.meetings]);

  function buildScope() {
    if (scope === "dates") return { from: from || undefined, to: to || undefined };
    if (scope === "council") return { bodies: [BODY_OPTIONS[0].key] };
    if (scope === "meeting") return meetingId ? { meetingIds: [meetingId] } : {};
    return {};
  }

  async function ask() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setAsking(true);
    setCancelling(false);
    setNotice(null);
    const res = await api.ask(text, buildScope());
    setBusy(false);
    setAsking(false);
    setCancelling(false);
    if (!res.ok) {
      if (res.cancelled) return setNotice({ kind: "ok", text: "Cancelled." });
      return setNotice({ kind: "error", text: res.error, settings: res.needsSettings });
    }
    const entry = { id: res.id, askedAt: res.askedAt, question: text, scope: buildScope(), answer: res.answer, citations: res.citations || [] };
    setCurrent(entry);
    setHistory((h) => [entry, ...h.filter((a) => a.id !== entry.id)]);
  }

  async function cancel() {
    setCancelling(true);
    await api.cancel();
  }

  async function removeAsk(id) {
    const res = await api.removeAsk(id);
    if (res.ok) setHistory(res.asks || []);
    if (current && current.id === id) setCurrent(null);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  const html = useMemo(() => (current ? withCitationChips(renderMarkdown(current.answer), current.citations) : ""), [current]);

  function onAnswerClick(e) {
    const chip = e.target.closest && e.target.closest(".cite-chip");
    if (!chip) return;
    const n = Number(chip.dataset.n);
    const row = document.getElementById(`cite-${n}`);
    if (row) row.scrollIntoView({ block: "nearest" });
    setFlash(n);
    setTimeout(() => setFlash(null), 1800);
  }

  const citeOpen = (c) => go.toMeeting(c.meetingId, { tab: "transcript", sec: c.sec });

  return (
    <section className="view view-ask" aria-label="Ask Claude">
      <div className="ask-grid">
        <aside className="ask-history ov-quicklinks">
          <p className="ov-quicklinks-title">Recent questions</p>
          {history.length === 0 && <p className="muted pad">Questions you ask are kept here, with their answers.</p>}
          <ul className="history-rows">
            {history.map((a) => (
              <li key={a.id} className={current && current.id === a.id ? "history-row active" : "history-row"}>
                <button className="history-main" onClick={() => setCurrent(a)}>
                  <span className="history-q">{a.question}</span>
                  <span className="history-meta">
                    {savedAtTime(a.askedAt)} · {scopeLabel(a.scope)}
                  </span>
                </button>
                <button className="link-button history-remove" onClick={() => removeAsk(a.id)} aria-label={`Remove “${a.question}”`} title="Remove">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="ask-main">
          <div className="pane ask-box">
            <div className="pane-body">
              <div className="ov-field">
                <label className="ov-label" htmlFor="ask-question">
                  Question
                </label>
                <textarea
                  id="ask-question"
                  className="ov-input"
                  ref={textareaRef}
                  rows={3}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="What has the Council said about the Naranja Park bond? When did the water rate study come up?"
                  disabled={busy}
                />
              </div>
              <fieldset className="ask-scope ov-field" role="radiogroup" aria-label="Which meetings to look through">
                <legend className="ov-label">Which meetings</legend>
                <div className="row">
                  {SCOPES.map((s) => (
                    <label key={s.key} className="inline">
                      <input type="radio" name="ask-scope" value={s.key} checked={scope === s.key} onChange={() => setScope(s.key)} disabled={busy} />
                      {s.label}
                    </label>
                  ))}
                  {scope === "dates" && (
                    <span className="scope-extra">
                      <input className="ov-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" disabled={busy} />
                      <span className="muted">to</span>
                      <input className="ov-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" disabled={busy} />
                    </span>
                  )}
                  {scope === "meeting" && (
                    <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} aria-label="Meeting" disabled={busy} className="scope-extra ov-input">
                      <option value="">Choose a meeting…</option>
                      {withTranscript.map((m) => (
                        <option key={m.id} value={m.id}>
                          {shortDate(m.draft.date)} · {m.source.title || m.draft.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </fieldset>
              <div className="row ask-actions">
                <button className="ov-btn ov-btn-cta ai" onClick={ask} disabled={busy || !question.trim() || (scope === "meeting" && !meetingId)}>
                  <Sparkle />
                  Ask
                </button>
                <span className="muted">Enter asks · Shift+Enter adds a line</span>
              </div>
            </div>
          </div>

          {asking && <Working text={progress || "Asking Claude…"} cancelling={cancelling} onCancel={cancel} />}

          {!asking && !current && (
            <p className="muted ask-empty">
              Claude reads the saved transcripts and summaries that match your question and answers with numbered
              sources. Each source opens the transcript at that moment, so you can check it.
            </p>
          )}

          {current && !asking && (
            <article className="pane answer-card" aria-label="Answer">
              <header className="answer-head">
                <p className="answer-question">{current.question}</p>
                <p className="muted">
                  {savedAtTime(current.askedAt)} · {scopeLabel(current.scope)}
                </p>
              </header>
              <div className="answer-body ov-prose" ref={answerRef} onClick={onAnswerClick} dangerouslySetInnerHTML={{ __html: html }} />
              {current.citations && current.citations.length > 0 && (
                <div className="sources">
                  <p className="section-label">Sources</p>
                  <div className="ov-table-wrap">
                    <table className="ov-table source-rows">
                      <thead>
                        <tr>
                          <th scope="col">Source</th>
                          <th scope="col">Meeting and moment</th>
                          <th scope="col">Video</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.citations.map((c) => {
                          const at = c.clipId ? playUrlFor(c.clipId, Math.max(0, (c.sec || 0) - 3)) : null;
                          return (
                            <tr key={c.n} id={`cite-${c.n}`} className={flash === c.n ? "source-row flash" : "source-row"}>
                              <td>
                                <span className="cite-chip static" aria-hidden="true">
                                  {c.n}
                                </span>
                              </td>
                              <td>
                                <button className="source-main link-button" onClick={() => citeOpen(c)} title="Open the transcript here">
                                  <span className="source-meta">
                                    {formatDate(c.date, "short") || "Date needed"} · {c.title}
                                    {c.time ? ` · ${c.time}` : ""}
                                  </span>
                                  {c.quote && <span className="source-quote">“{c.quote}”</span>}
                                </button>
                              </td>
                              <td>
                                {at && (
                                  <button className="link-button ov-link watch-at" onClick={() => api.openExternal(at)}>
                                    Watch
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </article>
          )}

          <p className="ov-emphasis-2 ask-note">
            Answers come from automatic transcripts and staff summaries; verify against the video before relying on
            them.
          </p>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../../../../widget/render.js";
import { api } from "../api.js";
import { TOPIC_COLORS, lastMonths, monthLabel, plural, topicQuery } from "../util.js";
import { Dot } from "../components/ui.jsx";

/** Mentions per month for the last 12 months: plain SVG bars in the topic colour. */
function MonthChart({ byMonth, color, name }) {
  const months = lastMonths(12);
  const hits = new Map((byMonth || []).map((m) => [String(m.month).slice(0, 7), Number(m.hits) || 0]));
  const values = months.map((m) => hits.get(m) || 0);
  const max = Math.max(1, ...values);
  const W = 560;
  const H = 180;
  const padL = 28;
  const padB = 26;
  const padT = 14;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const slot = plotW / months.length;
  const barW = Math.max(6, Math.min(28, slot - 10));
  const total = values.reduce((a, b) => a + b, 0);
  const peak = values.indexOf(max);
  const ticks = max <= 4 ? [max] : [Math.round(max / 2), max];

  return (
    <figure className="month-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="month-chart-title" width="100%">
        <title id="month-chart-title">
          {`Mentions of ${name} by month, last 12 months: ${months.map((m, i) => `${monthLabel(m)} ${values[i]}`).join(", ")}`}
        </title>
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} className="chart-grid" />
              <text x={padL - 6} y={y + 4} className="chart-tick" textAnchor="end">
                {t}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} className="chart-axis" />
        {months.map((m, i) => {
          const v = values[i];
          const h = v ? Math.max(3, (v / max) * plotH) : 0;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padT + plotH - h;
          return (
            <g key={m}>
              {v > 0 && (
                <path
                  d={`M${x} ${padT + plotH} V${y + 4} a4 4 0 0 1 4 -4 h${barW - 8} a4 4 0 0 1 4 4 V${padT + plotH} Z`}
                  fill={color}
                >
                  <title>{`${monthLabel(m)}: ${plural(v, "mention")}`}</title>
                </path>
              )}
              {v > 0 && i === peak && (
                <text x={x + barW / 2} y={y - 5} className="chart-value" textAnchor="middle">
                  {v}
                </text>
              )}
              <text x={x + barW / 2} y={H - 8} className="chart-tick" textAnchor="middle">
                {monthLabel(m, { year: false })}
                {/^\d{4}-01$/.test(m) || i === 0 ? ` ’${m.slice(2, 4)}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="muted">
        {total ? `${plural(total, "mention")} in the last 12 months.` : "No mentions in the last 12 months."}
      </figcaption>
    </figure>
  );
}

function TopicForm({ initial, onSave, onCancel, saving, submitLabel }) {
  const [name, setName] = useState(initial.name || "");
  const [terms, setTerms] = useState(Array.isArray(initial.terms) ? initial.terms.join(", ") : initial.terms || "");
  const [color, setColor] = useState(initial.color || TOPIC_COLORS[0]);
  const list = terms.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <form
      className="topic-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && list.length) onSave({ name: name.trim(), terms: list, color });
      }}
    >
      <label>
        Topic name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Water rates" autoFocus />
      </label>
      <label>
        Words and phrases to watch <span className="muted">(comma-separated)</span>
        <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="water rate, water rates, rate increase" />
      </label>
      <div className="row color-row" role="radiogroup" aria-label="Colour">
        {TOPIC_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={`Colour ${c}`}
            className={color === c ? "swatch on" : "swatch"}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="row">
        <button type="submit" className="primary" disabled={saving || !name.trim() || !list.length}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Topics({ active, go, setNotice, onTopicsChanged, topicsVersion, selectedTopicId, setSelectedTopicId }) {
  const [overview, setOverview] = useState(null);
  const [stats, setStats] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadOverview() {
    const [res, list] = await Promise.all([api.topicsOverview(), api.listTopics()]);
    if (!res.ok) return setError(res.error);
    setError("");
    // The overview carries the counts; the store carries each topic's terms.
    const terms = new Map(((list && list.topics) || []).map((t) => [t.id, t.terms]));
    setOverview((res.overview || []).map((t) => ({ ...t, terms: terms.get(t.topicId) || t.terms || [] })));
  }

  useEffect(() => {
    if (active) loadOverview();
  }, [active, topicsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const topics = overview || [];
  const selected = topics.find((t) => t.topicId === selectedTopicId) || null;
  useEffect(() => {
    if (!selected && topics.length && !adding) setSelectedTopicId(topics[0].topicId);
  }, [overview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active || !selectedTopicId) return undefined;
    let live = true;
    setStats(null);
    api.topicStats(selectedTopicId, {}).then((res) => {
      if (!live) return;
      if (res.ok) setStats(res.stats);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [active, selectedTopicId, topicsVersion]);

  const nextColor = useMemo(() => TOPIC_COLORS[topics.length % TOPIC_COLORS.length], [topics.length]);

  async function add(fields) {
    setSaving(true);
    const res = await api.addTopic(fields);
    setSaving(false);
    if (!res.ok) return setNotice({ kind: "error", text: res.error });
    setAdding(false);
    if (res.topic && res.topic.id) setSelectedTopicId(res.topic.id);
    onTopicsChanged();
    setNotice({ kind: "ok", text: `Now watching “${fields.name}”.` });
  }

  async function update(fields) {
    setSaving(true);
    const res = await api.updateTopic(selected.topicId, fields);
    setSaving(false);
    if (!res.ok) return setNotice({ kind: "error", text: res.error });
    setEditing(false);
    onTopicsChanged();
    setNotice({ kind: "ok", text: "Topic updated." });
  }

  async function remove() {
    if (!window.confirm(`Stop watching “${selected.name}”? Its chart and counts go away; the transcripts are not touched.`)) return;
    const res = await api.removeTopic(selected.topicId);
    if (!res.ok) return setNotice({ kind: "error", text: res.error });
    setSelectedTopicId(null);
    onTopicsChanged();
    setNotice({ kind: "ok", text: "Topic removed." });
  }

  const openInSearch = (topic, extra = {}) => go.toSearch({ text: topicQuery(topic), ...extra });

  return (
    <section className="view view-topics" aria-label="Topics">
      <div className="topics-grid">
        <aside className="topics-list pane">
          <div className="pane-head topics-list-head">
            <span>Watched topics</span>
            <button className="link-button" onClick={() => { setAdding(true); setEditing(false); }}>
              Add topic
            </button>
          </div>
          {overview === null && !error && <p className="muted pad">Loading…</p>}
          {error && <p className="error pad">{error}</p>}
          {overview && topics.length === 0 && !adding && (
            <p className="muted pad">
              No topics yet. A topic is a set of words or phrases the app counts in every transcript, so you can see
              when something comes up and where.
            </p>
          )}
          <ul className="topic-rows">
            {topics.map((t) => (
              <li key={t.topicId}>
                <button
                  className={t.topicId === selectedTopicId && !adding ? "topic-row active" : "topic-row"}
                  onClick={() => { setSelectedTopicId(t.topicId); setAdding(false); setEditing(false); }}
                >
                  <span className="topic-row-name">
                    <Dot color={t.color} />
                    {t.name}
                  </span>
                  <span className="topic-row-meta">
                    {plural(t.totalHits || 0, "mention")} · {plural(t.meetingsCount || 0, "meeting")}
                    {t.lastDate ? ` · last ${formatDate(t.lastDate, "short")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="topic-detail">
          {adding && (
            <div className="pane topic-card">
              <p className="pane-head">New topic</p>
              <div className="pane-body">
                <TopicForm initial={{ color: nextColor }} onSave={add} onCancel={() => setAdding(false)} saving={saving} submitLabel="Watch this topic" />
              </div>
            </div>
          )}

          {!adding && !selected && overview && (
            <div className="empty-state topics-empty">
              <p>
                {topics.length ? "Pick a topic on the left." : "Add a topic to start tracking it across meetings."}
              </p>
              {!topics.length && (
                <button className="primary" onClick={() => setAdding(true)}>
                  Add topic
                </button>
              )}
            </div>
          )}

          {!adding && selected && (
            <>
              <header className="topic-head">
                <div>
                  <h2>
                    <Dot color={selected.color} />
                    {selected.name}
                  </h2>
                  <p className="muted">
                    Watching: {(selected.terms || []).join(", ")}
                  </p>
                </div>
                <div className="row">
                  <button onClick={() => openInSearch(selected)}>Open in Search</button>
                  <button onClick={() => setEditing((v) => !v)}>{editing ? "Close editor" : "Edit"}</button>
                  <button onClick={remove}>Remove</button>
                </div>
              </header>

              {editing && (
                <div className="pane topic-card">
                  <p className="pane-head">Edit topic</p>
                  <div className="pane-body">
                    <TopicForm initial={selected} onSave={update} onCancel={() => setEditing(false)} saving={saving} submitLabel="Save changes" />
                  </div>
                </div>
              )}

              <div className="pane topic-card">
                <p className="pane-head">Mentions by month</p>
                <div className="pane-body">
                  {stats ? <MonthChart byMonth={stats.byMonth} color={selected.color} name={selected.name} /> : <p className="muted">Counting…</p>}
                </div>
              </div>

              <div className="pane topic-card">
                <p className="pane-head">
                  Meetings{stats ? ` (${stats.meetingsCount || 0}) · ${plural(stats.totalHits || 0, "mention")} in all` : ""}
                </p>
                {stats && (stats.meetings || []).length === 0 && (
                  <p className="muted pad">No saved transcript, summary or minutes draft mentions this topic yet.</p>
                )}
                {stats && stats.meetings && stats.meetings.length > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Meeting</th>
                        <th>Body</th>
                        <th className="num">Mentions</th>
                        <th>First mention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.meetings.map((m) => (
                        <tr key={m.meetingId}>
                          <td className="nowrap">{formatDate(m.date, "short") || "Date needed"}</td>
                          <td>
                            <button className="link-button" onClick={() => openInSearch(selected, { meetingId: m.meetingId, meetingDate: m.date })}>
                              {m.title}
                            </button>
                          </td>
                          <td>{m.body || ""}</td>
                          <td className="num">{m.hits}</td>
                          <td className="nowrap">
                            {m.firstSec != null ? (
                              <button className="turn-time" onClick={() => go.toMeeting(m.meetingId, { tab: "transcript", sec: m.firstSec })} title="Open the transcript here">
                                {m.firstTime || `${m.firstSec}s`}
                              </button>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

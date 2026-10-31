import { useEffect, useState } from "react";
import { formatDate } from "../../../../widget/render.js";
import { api } from "../api.js";
import { shortDate, STATUS_LABELS, PENDING_LABELS, JOB_LABELS, topicQuery } from "../util.js";
import { Mark, SearchIcon } from "../components/icons.jsx";
import { Link, Working, Dot } from "../components/ui.jsx";
import { SummaryPanel } from "./meeting/SummaryPanel.jsx";
import { TranscriptPanel } from "./meeting/TranscriptPanel.jsx";
import { MinutesPanel } from "./meeting/MinutesPanel.jsx";
import { AgendaPanel } from "./meeting/AgendaPanel.jsx";

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

/* -------------------------------------------------------------- Meeting view */

function MeetingView({ meeting, onState, setNotice, busy, setBusy, onDirty, progress, intent, go, topicsVersion }) {
  const [view, setView] = useState((intent && intent.tab) || "summary");
  const [scrollTo, setScrollTo] = useState(intent && intent.tab === "transcript" && intent.sec != null ? intent : null);
  const [job, setJob] = useState(null); // "summary" | "transcript" | "minutes" while one runs
  const [cancelling, setCancelling] = useState(false);
  const [topics, setTopics] = useState([]);
  const s = meeting.source || {};

  // Another view asked for a tab (and perhaps a moment in the transcript).
  useEffect(() => {
    if (!intent) return;
    setView(intent.tab || "summary");
    if (intent.tab === "transcript" && intent.sec != null) setScrollTo(intent);
  }, [intent]);

  // Watched topics that come up in this meeting.
  const transcriptKey = meeting.transcript ? meeting.transcript.savedAt : "";
  useEffect(() => {
    let live = true;
    api.topicsForMeeting(meeting.id).then((res) => {
      if (live && res && res.ok) setTopics((res.topics || []).filter((t) => t.hits > 0));
    });
    return () => {
      live = false;
    };
  }, [meeting.id, transcriptKey, meeting.draft.overview, meeting.minutes && meeting.minutes.savedAt, topicsVersion]);

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

  function onTabKey(e) {
    const idx = VIEWS.findIndex((v) => v.key === view);
    let next = null;
    if (e.key === "ArrowRight") next = VIEWS[(idx + 1) % VIEWS.length];
    if (e.key === "ArrowLeft") next = VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length];
    if (e.key === "Home") next = VIEWS[0];
    if (e.key === "End") next = VIEWS[VIEWS.length - 1];
    if (!next) return;
    e.preventDefault();
    setView(next.key);
    const el = e.currentTarget.querySelector(`[data-tab="${next.key}"]`);
    if (el) el.focus();
  }

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
          {topics.length > 0 && (
            <p className="topic-chips" aria-label="Watched topics in this meeting">
              {topics.map((t) => (
                <button
                  key={t.topicId}
                  className="topic-chip"
                  title={`Search this meeting for “${t.name}”`}
                  onClick={() => go.toSearch({ text: topicQuery(t), meetingId: meeting.id, meetingDate: meeting.draft.date })}
                >
                  <Dot color={t.color} />
                  {t.name}
                  <span className="topic-chip-count">{t.hits}</span>
                </button>
              ))}
            </p>
          )}
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
        <Working text={progress || `${JOB_LABELS[job] || "Working"}…`} cancelling={cancelling} onCancel={cancel} />
      )}

      <div className="view-tabs" role="tablist" aria-label="Meeting views" onKeyDown={onTabKey}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            data-tab={v.key}
            aria-selected={view === v.key}
            aria-controls={`panel-${v.key}`}
            tabIndex={view === v.key ? 0 : -1}
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
          scrollTo={scrollTo}
          onSearchAll={(text) => go.toSearch({ text })}
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

/* ------------------------------------------------------------ Meetings view */

export function Meetings({ state, selectedId, onSelect, onState, setNotice, busy, setBusy, onDirty, progress, intent, go, topicsVersion }) {
  const [tab, setTab] = useState("review");
  const [query, setQuery] = useState("");

  const byTab = (status) => state.meetings.filter((m) => m.status === status);
  const q = query.trim().toLowerCase();
  const matchesQuery = (m) =>
    !q ||
    `${shortDate(m.draft.date)} ${m.draft.date || ""} ${m.source.title || ""} ${m.source.body || ""} ${m.draft.title || ""}`
      .toLowerCase()
      .includes(q);
  const list = byTab(tab).filter(matchesQuery);
  const selected = state.meetings.find((m) => m.id === selectedId) || null;

  // A meeting opened from Search, Topics or Ask may sit under another status tab: follow it.
  useEffect(() => {
    if (selected && selected.status !== tab) setTab(selected.status);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
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
                placeholder="Find a meeting by date or name…"
                aria-label="Find a meeting"
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
                <button className={m.id === selectedId ? "meeting active" : "meeting"} onClick={() => onSelect(m.id)}>
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
          onState={onState}
          setNotice={setNotice}
          busy={busy}
          setBusy={setBusy}
          onDirty={onDirty}
          progress={progress}
          intent={intent}
          go={go}
          topicsVersion={topicsVersion}
        />
      ) : (
        <section className="editor editor-empty">
          <div className="empty-state">
            <Mark size={56} />
            <p>Choose a meeting on the left to see its summary, transcript, draft minutes, and agenda.</p>
            {state.meetings.length > 0 && (
              <p className="muted">
                Or search every saved transcript from{" "}
                <button className="link-button" onClick={() => go.toSearch({})}>
                  Search
                </button>
                .
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

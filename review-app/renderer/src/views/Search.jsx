import { useEffect, useRef, useState } from "react";
import { formatDate } from "../../../../widget/render.js";
import { api } from "../api.js";
import { playUrlFor } from "../transcript.js";
import { BODY_OPTIONS, TOPIC_COLORS, termsFromQuery, monthLabel, plural } from "../util.js";
import { SearchIcon, PlayIcon } from "../components/icons.jsx";
import { KindBadge, RangeHighlight } from "../components/ui.jsx";

const KIND_OPTIONS = [
  { key: "transcript", label: "Transcripts" },
  { key: "summary", label: "Summaries" },
  { key: "minutes", label: "Minutes drafts" },
];

export const EMPTY_SEARCH = {
  text: "",
  kinds: ["transcript", "summary", "minutes"],
  bodies: [],
  from: "",
  to: "",
  sort: "relevance",
  meetingId: null, // set when a topic chip asked for one meeting only
  meetingDate: null,
  seq: 0, // bumped by other views so the same text runs again
};

/** "42 transcripts · 118 hours · Oct 2024 – Oct 2026" */
export function corpusLine(stats) {
  if (!stats) return "";
  const parts = [plural(stats.transcripts || 0, "transcript")];
  const hours = stats.hours != null ? stats.hours : stats.transcriptHours;
  if (hours) parts.push(`${Math.round(hours)} hours`);
  if (stats.summaries) parts.push(plural(stats.summaries, "summary", "summaries"));
  if (stats.minutesDrafts) parts.push(plural(stats.minutesDrafts, "minutes draft"));
  if (stats.earliest && stats.latest) {
    const a = monthLabel(stats.earliest);
    const b = monthLabel(stats.latest);
    parts.push(a === b ? a : `${a} – ${b}`);
  }
  return parts.join(" · ");
}

function toggle(list, key) {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function Search({ active, state, query, setQuery, go, setNotice, openTranscribe, onTopicsChanged, topicsCount }) {
  const [stats, setStats] = useState(null);
  const [result, setResult] = useState(null); // { query, total, hits, meetings, ms }
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [saveTopic, setSaveTopic] = useState(null); // { name } while the small form is open
  const inputRef = useRef(null);
  const runId = useRef(0);
  const text = query.text || "";
  const filterKey = JSON.stringify([query.kinds, query.bodies, query.from, query.to, query.sort, query.seq]);

  useEffect(() => {
    if (!active) return;
    api.searchStats().then((res) => res && res.ok && setStats(res.stats));
    if (inputRef.current && !text) inputRef.current.focus();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    const trimmed = text.trim();
    if (!trimmed) {
      setResult(null);
      setError("");
      return;
    }
    const id = ++runId.current;
    // Body filters and the one-meeting scope both become a list of meeting ids, so
    // boards and commissions (whose body names vary) work the same as the Council.
    let meetingIds;
    if (query.meetingId) meetingIds = [query.meetingId];
    else if (query.bodies.length) {
      const kinds = new Set(BODY_OPTIONS.filter((b) => query.bodies.includes(b.key)).flatMap((b) => b.kinds));
      meetingIds = state.meetings.filter((m) => kinds.has((m.source || {}).kind)).map((m) => m.id);
      if (!meetingIds.length) {
        setResult({ total: 0, hits: 0, meetings: [], ms: 0 });
        setError("");
        return;
      }
    }
    setSearching(true);
    const started = performance.now();
    const res = await api.search(trimmed, {
      kinds: query.kinds,
      meetingIds,
      from: query.from || undefined,
      to: query.to || undefined,
      sort: query.sort === "newest" ? "date" : "relevance",
    });
    if (id !== runId.current) return;
    setSearching(false);
    if (!res.ok) {
      setError(res.error);
      setResult(null);
      return;
    }
    setError("");
    setResult({ ...res.result, ms: Math.round(performance.now() - started) });
  }

  // Enter runs at once; typing runs after a short pause.
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }, [text, filterKey, active]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  }

  async function addTopic() {
    const name = String(saveTopic.name || "").trim();
    const terms = termsFromQuery(text);
    if (!name || !terms.length) return;
    const color = TOPIC_COLORS[(topicsCount || 0) % TOPIC_COLORS.length];
    const res = await api.addTopic({ name, terms, color });
    if (!res.ok) return setNotice({ kind: "error", text: res.error });
    setSaveTopic(null);
    onTopicsChanged();
    setNotice({ kind: "ok", text: `Now watching “${name}”. See it under Topics.` });
  }

  const shownMeetings = (result && result.meetings) || [];
  const shownHits = result ? result.hits || 0 : 0;
  const empty = stats && !stats.transcripts && !stats.summaries && !stats.minutesDrafts;

  return (
    <section className="view view-search" aria-label="Search">
      <header className="view-head">
        <div className="view-title">
          <h2>Search</h2>
          <p className="corpus-line" aria-live="polite">
            {stats ? corpusLine(stats) : "Reading the saved transcripts…"}
          </p>
        </div>
      </header>

      <div className="search-box">
        <div className="search-field search-big">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="search"
            className="search-input"
            placeholder="Search every transcript, summary and minutes draft…"
            aria-label="Search all meetings"
            value={text}
            onChange={(e) => setQuery({ ...query, text: e.target.value })}
            onKeyDown={onKeyDown}
          />
        </div>
        <p className="hint search-hint">
          <code>"exact phrase"</code> · <code>-exclude</code> · <code>word*</code> matches word, words, wording…
        </p>

        <div className="filters" role="group" aria-label="Filters">
          <fieldset className="filter-group">
            <legend>Content</legend>
            {KIND_OPTIONS.map((k) => (
              <label key={k.key} className="inline">
                <input
                  type="checkbox"
                  checked={query.kinds.includes(k.key)}
                  onChange={() => setQuery({ ...query, kinds: toggle(query.kinds, k.key) })}
                />
                {k.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="filter-group">
            <legend>Body</legend>
            {BODY_OPTIONS.map((b) => (
              <label key={b.key} className="inline">
                <input
                  type="checkbox"
                  checked={query.bodies.includes(b.key)}
                  onChange={() => setQuery({ ...query, bodies: toggle(query.bodies, b.key) })}
                />
                {b.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="filter-group filter-dates">
            <legend>Dates</legend>
            <label className="inline">
              From
              <input type="date" value={query.from} onChange={(e) => setQuery({ ...query, from: e.target.value })} />
            </label>
            <label className="inline">
              To
              <input type="date" value={query.to} onChange={(e) => setQuery({ ...query, to: e.target.value })} />
            </label>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Sort</legend>
            <select value={query.sort} onChange={(e) => setQuery({ ...query, sort: e.target.value })} aria-label="Sort results">
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
            </select>
          </fieldset>
        </div>

        {query.meetingId && (
          <p className="scope-note">
            Showing one meeting only{query.meetingDate ? ` (${formatDate(query.meetingDate, "short")})` : ""}.{" "}
            <button className="link-button" onClick={() => setQuery({ ...query, meetingId: null, meetingDate: null })}>
              Search all meetings
            </button>
          </p>
        )}
      </div>

      {error && <p className="error view-error">{error}</p>}

      {!text.trim() && (
        <div className="search-empty">
          {empty ? (
            <div className="callout stack">
              <p>
                <strong>Nothing to search yet.</strong> Search looks through the transcripts, summaries and minutes
                drafts saved on this computer. Transcribe a few meetings and they become searchable here.
              </p>
              <div className="row">
                <button className="primary" onClick={openTranscribe}>
                  Transcribe meetings…
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">
              Search covers the saved transcripts, summaries and minutes drafts. Try a street name, a project, a vote,
              or a phrase someone said. Click a result to open the transcript at that moment.{" "}
              <button className="link-button" onClick={openTranscribe}>
                Transcribe more meetings
              </button>
            </p>
          )}
        </div>
      )}

      {text.trim() && result && (
        <>
          <div className="results-bar">
            <span className="results-count" aria-live="polite">
              {plural(shownMeetings.length, "meeting")} · {plural(shownHits, "match", "matches")} · {result.ms} ms
              {searching ? " · updating…" : ""}
            </span>
            <span className="spacer" />
            {saveTopic ? (
              <form
                className="save-topic"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTopic();
                }}
              >
                <label className="inline">
                  Topic name
                  <input value={saveTopic.name} onChange={(e) => setSaveTopic({ name: e.target.value })} autoFocus />
                </label>
                <button type="submit" disabled={!saveTopic.name.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => setSaveTopic(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button onClick={() => setSaveTopic({ name: termsFromQuery(text).join(", ") })} disabled={!termsFromQuery(text).length}>
                Save as topic
              </button>
            )}
          </div>

          {shownMeetings.length === 0 && (
            <p className="muted search-none">
              No matches{query.meetingId ? " in this meeting" : ""}. Try fewer words, a <code>word*</code> wildcard, or
              widen the filters.
            </p>
          )}

          <ol className="result-list">
            {shownMeetings.map((m) => {
              const watchUrl = m.playerUrl || playUrlFor(m.clipId, 0);
              return (
                <li key={m.meetingId} className="result">
                  <header className="result-head">
                    <button className="result-title" onClick={() => go.toMeeting(m.meetingId, { tab: "summary" })}>
                      <span className="result-date">{formatDate(m.date, "short") || "Date needed"}</span>
                      <span className="result-name">{m.title}</span>
                    </button>
                    <span className="result-meta">
                      {m.body ? `${m.body} · ` : ""}
                      {plural(m.hits || 0, "match", "matches")}
                    </span>
                    {watchUrl && (
                      <button className="link-button" onClick={() => api.openExternal(watchUrl)}>
                        Watch
                      </button>
                    )}
                  </header>
                  <ul className="snippets">
                    {(m.snippets || []).map((sn, i) => {
                      const isTurn = sn.kind === "transcript";
                      const open = () =>
                        go.toMeeting(m.meetingId, isTurn ? { tab: "transcript", sec: sn.sec } : { tab: sn.kind === "minutes" ? "minutes" : "summary" });
                      const at = isTurn && m.clipId ? playUrlFor(m.clipId, Math.max(0, (sn.sec || 0) - 3)) : null;
                      return (
                        <li key={i} className="snippet">
                          <button className="snippet-main" onClick={open} title={isTurn ? "Open the transcript at this moment" : "Open this meeting"}>
                            <span className="snippet-meta">
                              <KindBadge kind={sn.kind} />
                              {isTurn && <span className="snippet-time">{sn.time}</span>}
                              {isTurn && sn.speaker && <span className="snippet-speaker">{sn.speaker}</span>}
                            </span>
                            <span className="snippet-text">
                              <RangeHighlight text={sn.text || ""} ranges={sn.ranges} />
                            </span>
                          </button>
                          {at && (
                            <button className="link-button watch-at" onClick={() => api.openExternal(at)}>
                              <PlayIcon /> Watch at {sn.time}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

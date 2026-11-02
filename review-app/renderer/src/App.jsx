import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Mark, BannerIcon } from "./components/icons.jsx";
import { Settings } from "./components/Settings.jsx";
import { TranscribeDialog } from "./components/TranscribeDialog.jsx";
import { QueueDrawer } from "./components/QueueDrawer.jsx";
import { Meetings } from "./views/Meetings.jsx";
import { Search, EMPTY_SEARCH } from "./views/Search.jsx";
import { Topics } from "./views/Topics.jsx";
import { Ask } from "./views/Ask.jsx";

const NAV = [
  { key: "meetings", label: "Meetings" },
  { key: "search", label: "Search" },
  { key: "topics", label: "Topics" },
  { key: "ask", label: "Ask" },
];

const NO_JOBS = { running: null, pending: [], done: [] };

export default function App() {
  const [state, setState] = useState(null);
  const [nav, setNav] = useState("meetings");
  const [selectedId, setSelectedId] = useState(null);
  const [intent, setIntent] = useState(null); // { tab, sec, seq } for the open meeting
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState(null);
  const [update, setUpdate] = useState(null); // { state, version, percent, error } from the auto-updater
  const [appVersion, setAppVersion] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [jobs, setJobs] = useState(NO_JOBS);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const [topicsVersion, setTopicsVersion] = useState(0);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const dirtyRef = useRef({});
  const doneCount = useRef(0);
  const onDirty = useRef((kind, value) => {
    dirtyRef.current = { ...dirtyRef.current, [kind]: value };
  }).current;

  useEffect(() => {
    api.getState().then((s) => {
      setState(s);
      if (s && s.jobs) {
        setJobs(s.jobs);
        doneCount.current = (s.jobs.done || []).length;
      }
    });
    const offProgress = api.onProgress(setProgress);
    const offUpdate = api.onUpdate ? api.onUpdate(setUpdate) : () => {};
    if (api.updateStatus) api.updateStatus().then((r) => r && r.ok && setAppVersion(r.version));
    const offJobs = api.onJobs((status) => {
      setJobs(status || NO_JOBS);
      // A finished job may have saved a transcript, summary or minutes draft: pick it up.
      const done = ((status && status.done) || []).length;
      if (done !== doneCount.current) {
        doneCount.current = done;
        api.getState().then(setState);
      }
    });
    return () => {
      offProgress();
      offUpdate();
      offJobs();
    };
  }, []);

  if (!state) return null;

  const queueActive = Boolean(jobs.running) || (jobs.pending || []).length > 0;
  const anyBusy = busy || queueActive;
  const settings = state.settings;
  const missing = [
    !settings.hasAnthropicApiKey && "the Anthropic API key",
    !settings.hasDeepgramApiKey && "the Deepgram API key",
  ].filter(Boolean);
  const queueTotal = (jobs.done || []).length + (jobs.running ? 1 : 0) + (jobs.pending || []).length;
  const queueAt = (jobs.done || []).length + (jobs.running ? 1 : 0);

  async function refresh() {
    setBusy(true);
    setNotice(null);
    const result = await api.refresh();
    setBusy(false);
    if (!result.ok) return setNotice({ kind: "error", text: result.error, settings: result.needsSettings });
    setState(result.state);
    setNotice({
      kind: "ok",
      text: result.added
        ? `Loaded ${result.added} new meeting video${result.added === 1 ? "" : "s"} from Swagit.`
        : "No new meeting videos on Swagit.",
    });
  }

  /** Change the open meeting, after the unsaved-changes check. Returns false if the reviewer kept their edits. */
  function select(id, nextIntent = null) {
    if (id !== selectedId) {
      if (busy) return false;
      const parts = [dirtyRef.current.summary && "summary", dirtyRef.current.minutes && "draft minutes"].filter(Boolean);
      if (parts.length && !window.confirm(`You have unsaved changes to this meeting's ${parts.join(" and ")}. Discard them?`)) return false;
      dirtyRef.current = {};
      setSelectedId(id);
      setNotice(null);
    }
    setIntent(nextIntent ? { ...nextIntent, seq: Date.now() } : null);
    return true;
  }

  const go = {
    toMeeting(id, nextIntent) {
      if (!select(id, nextIntent || { tab: "summary" })) return;
      setNav("meetings");
    },
    toSearch(partial) {
      setSearch((q) => ({
        ...q,
        ...partial,
        text: partial.text != null ? partial.text : q.text,
        meetingId: partial.meetingId || null,
        meetingDate: partial.meetingDate || null,
        seq: (q.seq || 0) + 1,
      }));
      setNav("search");
    },
    toTopics(id) {
      if (id) setSelectedTopicId(id);
      setNav("topics");
    },
    toAsk() {
      setNav("ask");
    },
  };

  function onNavKey(e) {
    const idx = NAV.findIndex((n) => n.key === nav);
    let next = null;
    if (e.key === "ArrowRight") next = NAV[(idx + 1) % NAV.length];
    if (e.key === "ArrowLeft") next = NAV[(idx - 1 + NAV.length) % NAV.length];
    if (e.key === "Home") next = NAV[0];
    if (e.key === "End") next = NAV[NAV.length - 1];
    if (!next) return;
    e.preventDefault();
    setNav(next.key);
    const el = e.currentTarget.querySelector(`[data-nav="${next.key}"]`);
    if (el) el.focus();
  }

  return (
    <div className="app">
      <div className="app-hero">
        <header className="topbar ov-header">
          <div className="ov-header-logo" role="img" aria-label="Town of Oro Valley, Arizona" />
          <h1 className="ov-header-name">Council Dashboard</h1>
          <nav className="main-nav ov-nav" role="tablist" aria-label="Views" onKeyDown={onNavKey}>
            {NAV.map((n) => (
              <button
                key={n.key}
                role="tab"
                data-nav={n.key}
                aria-selected={nav === n.key}
                aria-current={nav === n.key ? "page" : undefined}
                tabIndex={nav === n.key ? 0 : -1}
                className={nav === n.key ? "tab ov-nav-link active" : "tab ov-nav-link"}
                onClick={() => setNav(n.key)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <span className="progress" aria-live="polite">
            {queueActive ? "" : progress}
          </span>
          <div className="topbar-actions">
            {queueActive && (
              <button className="pill pill-working" onClick={() => setShowQueue(true)} aria-label={`Working on ${queueAt} of ${queueTotal}; open the queue`}>
                <span className="spinner small" aria-hidden="true" />
                Working {queueAt}/{queueTotal}
              </button>
            )}
            {!queueActive && (jobs.done || []).length > 0 && (
              <button className="link-button quiet" onClick={() => setShowQueue(true)}>
                Queue
              </button>
            )}
            <button className="link-button" onClick={refresh} disabled={anyBusy}>
              Check for new meetings
            </button>
            <button className="ov-btn ov-btn-compact" onClick={() => setShowTranscribe(true)} disabled={state.meetings.length === 0}>
              Transcribe meetings…
            </button>
            <button className="link-button" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </header>
      </div>

      {missing.length > 0 && !setupDismissed && (
        <div className="banner ov-alert ov-alert-10" role="status">
          <BannerIcon kind="warn" />
          <p className="banner-text">
            Setup isn't finished on this computer. Add {missing.join(", ")} in Settings.{" "}
            <button className="link-button" onClick={() => setShowSettings(true)}>
              Open Settings
            </button>
          </p>
          <button className="ov-alert-dismiss" onClick={() => setSetupDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}
      {update && update.state === "ready" && (
        <div className="banner banner-ok ov-alert ov-alert-30" role="status">
          <BannerIcon kind="ok" />
          <p className="banner-text">
            Version {update.version} is downloaded and installs the next time the app starts.{" "}
            <button className="link-button" onClick={() => api.installUpdate()}>
              Restart and update now
            </button>
          </p>
          <button className="ov-alert-dismiss" onClick={() => setUpdate(null)}>
            Later
          </button>
        </div>
      )}
      {notice && (
        <div
          className={`banner banner-${notice.kind} ov-alert${notice.kind === "ok" ? " ov-alert-30" : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <BannerIcon kind={notice.kind} />
          <p className="banner-text">
            {notice.text}{" "}
            {notice.settings && (
              <button className="link-button" onClick={() => setShowSettings(true)}>
                Open Settings
              </button>
            )}
          </p>
          <button className="ov-alert-dismiss" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="views" hidden={nav !== "meetings"}>
        <Meetings
          state={state}
          selectedId={selectedId}
          onSelect={(id) => select(id, null)}
          onState={setState}
          setNotice={setNotice}
          busy={anyBusy}
          setBusy={setBusy}
          onDirty={onDirty}
          progress={progress}
          intent={intent}
          go={go}
          topicsVersion={topicsVersion}
        />
      </div>
      <div className="views" hidden={nav !== "search"}>
        <Search
          active={nav === "search"}
          state={state}
          query={search}
          setQuery={setSearch}
          go={go}
          setNotice={setNotice}
          openTranscribe={() => setShowTranscribe(true)}
          onTopicsChanged={() => setTopicsVersion((v) => v + 1)}
          topicsCount={topicsVersion}
        />
      </div>
      <div className="views" hidden={nav !== "topics"}>
        <Topics
          active={nav === "topics"}
          go={go}
          setNotice={setNotice}
          onTopicsChanged={() => setTopicsVersion((v) => v + 1)}
          topicsVersion={topicsVersion}
          selectedTopicId={selectedTopicId}
          setSelectedTopicId={setSelectedTopicId}
        />
      </div>
      <div className="views" hidden={nav !== "ask"}>
        <Ask active={nav === "ask"} state={state} busy={anyBusy} setBusy={setBusy} progress={progress} go={go} setNotice={setNotice} />
      </div>

      <footer className="app-footer ov-footer">
        <div className="ov-footer-bottom">
          <Mark size={40} footer />
          <span>
            Town of Oro Valley · 11000 N. La Cañada Drive · 520-229-4700 · Staff tool; summaries and drafts are not official records
            {appVersion ? ` · Version ${appVersion}` : ""}
            {update && update.state === "downloading" ? ` · Downloading update${update.percent ? ` ${update.percent}%` : ""}…` : ""}
            {appVersion && (
              <>
                {" · "}
                <button
                  className="link-button"
                  onClick={async () => {
                    const r = await api.checkForUpdates();
                    setNotice(r.ok ? { kind: "ok", text: "Checking for updates. You will see a banner here if one is ready." } : { kind: "error", text: r.error });
                  }}
                >
                  Check for updates
                </button>
              </>
            )}
          </span>
        </div>
      </footer>

      {showSettings && (
        <Settings
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(next, stayOpen) => {
            setState(next);
            if (!stayOpen) {
              setShowSettings(false);
              setNotice({ kind: "ok", text: "Settings saved." });
            }
          }}
        />
      )}

      {showTranscribe && (
        <TranscribeDialog
          settings={settings}
          busy={busy}
          onClose={() => setShowTranscribe(false)}
          onQueued={(res) => {
            setShowTranscribe(false);
            if (res.status) setJobs(res.status);
            setShowQueue(true);
            setNotice({
              kind: "ok",
              text: `Added ${res.added} job${res.added === 1 ? "" : "s"} to the queue${res.skipped ? ` (${res.skipped} already queued)` : ""}. The app works through them one at a time; you can keep browsing.`,
            });
          }}
        />
      )}

      {showQueue && (
        <QueueDrawer
          jobs={jobs}
          state={state}
          onClose={() => setShowQueue(false)}
          onOpenMeeting={(id) => {
            setShowQueue(false);
            go.toMeeting(id, { tab: "transcript" });
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { api } from "../api.js";
import { KIND_LABELS } from "../util.js";

export function WordCount({ text, limit }) {
  const words = (String(text).replace(/[#*_\-[\]()]/g, " ").match(/\S+/g) || []).length;
  return (
    <span className={words > limit ? "word-count over" : "word-count"}>
      {words} / {limit} words
    </span>
  );
}

export function Link({ url, children, className = "link-button ov-link" }) {
  return (
    <button className={className} onClick={() => api.openExternal(url)}>
      {children}
    </button>
  );
}

/** Close on Escape, for modals and drawers. */
export function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Put focus inside a dialog when it opens, and give it back when it closes. */
export function useInitialFocus(ref) {
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    if (el) {
      const target = el.querySelector("[autofocus], input, textarea, select, button");
      if (target) target.focus();
    }
    return () => {
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [ref]);
}

/** Plain substring highlight (the transcript's own search box). */
export function Highlight({ text, query }) {
  if (!query) return text;
  const parts = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, i)) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + query.length)}</mark>);
    i = at + query.length;
  }
  parts.push(text.slice(i));
  return parts;
}

/** Highlight the [start, end) ranges the search engine reports. */
export function RangeHighlight({ text, ranges }) {
  const list = Array.isArray(ranges) ? [...ranges].sort((a, b) => a[0] - b[0]) : [];
  if (!list.length) return text;
  const parts = [];
  let i = 0;
  for (const [s, e] of list) {
    if (s < i || e <= s) continue;
    if (s > i) parts.push(text.slice(i, s));
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>);
    i = e;
  }
  parts.push(text.slice(i));
  return parts;
}

/** A side drawer, for example the Town's published minutes next to the draft. */
export function Drawer({ title, subtitle, onClose, children, actions, wide }) {
  useEscape(onClose);
  const ref = useRef(null);
  useInitialFocus(ref);
  return (
    <aside className={wide ? "drawer drawer-wide" : "drawer"} role="dialog" aria-modal="false" aria-label={title} ref={ref}>
      <header className="drawer-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="row">
          {actions}
          <button className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}

/** A centred modal dialog. */
export function Modal({ title, titleId, onClose, children, wide }) {
  useEscape(onClose);
  const ref = useRef(null);
  useInitialFocus(ref);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={wide ? "modal modal-wide ov-prose" : "modal ov-prose"} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The "working" card: indeterminate bar, spinner, progress text, Cancel. */
export function Working({ text, cancelling, onCancel }) {
  return (
    <div className="working" role="status">
      <div className="working-bar" aria-hidden="true">
        <span className="working-bar-fill" />
      </div>
      <div className="working-row">
        <span className="spinner" aria-hidden="true" />
        <span className="text">{cancelling ? "Cancelling…" : text}</span>
        {onCancel && (
          <button className="link-button" onClick={onCancel} disabled={cancelling}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** "Transcript" / "Summary" / "Minutes draft" chip for a search hit. */
export function KindBadge({ kind }) {
  return <span className={`badge badge-kind badge-kind-${kind}`}>{KIND_LABELS[kind] || kind}</span>;
}

/** A coloured dot before a topic name. */
export function Dot({ color }) {
  return <span className="dot" style={{ background: color || "var(--blue)" }} aria-hidden="true" />;
}

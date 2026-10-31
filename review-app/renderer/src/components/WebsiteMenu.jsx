import { useEffect, useRef, useState } from "react";

/** The quiet "Website" menu: Publish to website (n) and Open the website. */
export function WebsiteMenu({ pendingCount, canPublish, widgetUrl, onPublish, onOpen }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        const btn = wrap.current && wrap.current.querySelector(".menu-button");
        if (btn) btn.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    const first = wrap.current && wrap.current.querySelector("[role=menuitem]:not(:disabled)");
    if (first) first.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function onMenuKey(e) {
    const items = [...wrap.current.querySelectorAll("[role=menuitem]:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }

  const pick = (fn) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={pendingCount ? "menu-button has-pending" : "menu-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Website
        {pendingCount ? <span className="count count-pending">{pendingCount}</span> : null}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Website" onKeyDown={onMenuKey}>
          <button role="menuitem" className={canPublish ? "menu-item primary" : "menu-item"} onClick={pick(onPublish)} disabled={!canPublish}>
            Publish to website{pendingCount ? ` (${pendingCount})` : ""}
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(onOpen)} disabled={!widgetUrl}>
            Open the website
          </button>
        </div>
      )}
    </div>
  );
}

import { useId } from "react";

// The Town's official seal, when Communications has supplied one (see assets/README.txt).
// import.meta.glob resolves to an empty object when the file is absent, so the build
// passes either way and the drawn badge below is used instead.
const sealModules = import.meta.glob("../assets/town-seal.png", { eager: true, import: "default" });
const SEAL_URL = sealModules["../assets/town-seal.png"] || null;

/** The Town mark: the official seal when present, otherwise an original badge in the
 *  brand colours (navy sky, gold sun, blue Santa Catalina silhouette, white horizon). */
export function Mark({ size = 40, footer = false, alt = "" }) {
  const clip = `mark-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (SEAL_URL) {
    // The seal is 180 x 173; keep its proportions at every size.
    const height = Math.round((size * 173) / 180);
    const label = alt || (footer ? "Town of Oro Valley Seal" : "");
    return (
      <img
        className={footer ? "mark mark-seal ov-footer-seal" : "mark mark-seal"}
        src={SEAL_URL}
        width={size}
        height={height}
        alt={label}
        aria-hidden={label ? undefined : "true"}
      />
    );
  }
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="19" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="23" fill="#002d74" />
      <circle cx="24" cy="24" r="19" fill="#e9f0f7" />
      <circle cx="29.5" cy="17" r="5.5" fill="#f7b917" />
      <g clipPath={`url(#${clip})`}>
        <path d="M0 34 L12 21 L19 28 L26 16 L33 26 L38 22 L48 34 Z" fill="#236298" />
        <rect x="0" y="34" width="48" height="14" fill="#0d5b9a" />
        <path d="M0 34 H48" stroke="#ffffff" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/** A four-point sparkle, shown before every action that asks the AI model to write.
 *  Purely decorative; it has no text so button labels stay unchanged. */
export function Sparkle() {
  return (
    <svg className="sparkle" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 C8.6 5 9.9 6.4 14.5 8 C9.9 9.6 8.6 11 8 14.5 C7.4 11 6.1 9.6 1.5 8 C6.1 6.4 7.4 5 8 1.5 Z" fill="currentColor" />
      <path d="M13 1 C13.2 2.2 13.7 2.8 15 3 C13.7 3.2 13.2 3.8 13 5 C12.8 3.8 12.3 3.2 11 3 C12.3 2.8 12.8 2.2 13 1 Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/** Small status icon for banners (decorative). */
export function BannerIcon({ kind }) {
  if (kind === "ok") {
    return (
      <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.8 8.2 L7 10.4 L11.3 5.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5 V8.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="0.95" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="banner-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.8 L15 13.8 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6 V9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.95" fill="currentColor" />
    </svg>
  );
}

/** Magnifier for search fields (decorative). */
export function SearchIcon({ size = 15 }) {
  return (
    <svg className="search-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.3 10.3 L14.2 14.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Play triangle for "Watch at …" links (decorative). */
export function PlayIcon() {
  return (
    <svg className="play-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M1.5 1 L9 5 L1.5 9 Z" fill="currentColor" />
    </svg>
  );
}

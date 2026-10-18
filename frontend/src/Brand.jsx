/**
 * The Navi mark: the core is the university's document base, the three arcs
 * are the three agents. The active agent's arc glows; for a guest none
 * glows, because a guest has no access to documents. The mark shows
 * the state of the system rather than just decorating.
 */
export function Mark({ agent = "guest", size = 30 }) {
  const arcs = [
    { id: "student", d: "M15 3.6a11.4 11.4 0 019.87 5.7" },
    { id: "teacher", d: "M24.87 20.7a11.4 11.4 0 01-9.87 5.7" },
    { id: "admin", d: "M15 26.4A11.4 11.4 0 015.13 9.3" },
  ];
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 30 30"
      fill="none" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {arcs.map((a) => (
        <path key={a.id} className={`arc ${agent === a.id ? "live" : ""}`} d={a.d} />
      ))}
      <circle className="halo" cx="15" cy="15" r="6.4" strokeWidth="1" />
      <circle className="core" cx="15" cy="15" r="3.1" />
    </svg>
  );
}

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

export const ICONS = {
  guest: (
    <svg viewBox="0 0 24 24" width="18" height="18" {...s}>
      <circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18 15 15 0 010-18z" />
    </svg>
  ),
  student: (
    <svg viewBox="0 0 24 24" width="18" height="18" {...s}>
      <path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
    </svg>
  ),
  teacher: (
    <svg viewBox="0 0 24 24" width="18" height="18" {...s}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" width="18" height="18" {...s}>
      <path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M10 21v-5h4v5" />
    </svg>
  ),
};

export const UI = {
  lock: <svg width="12" height="12" viewBox="0 0 24 24" {...s} strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  send: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2.4"><path d="M5 12h13M12 5l7 7-7 7" /></svg>,
  clip: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M21.4 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>,
  mic: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v4" /></svg>,
  sound: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></svg>,
  stop: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  ticket: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M4 8V6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 8v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-8z" /><path d="M12 6v12" /></svg>,
  chevron: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>,
  sun: <svg width="14" height="14" viewBox="0 0 24 24" {...s} strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg width="14" height="14" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>,
};

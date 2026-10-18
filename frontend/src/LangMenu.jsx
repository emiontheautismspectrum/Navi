import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { LANGS } from "./i18n.js";

/**
 * A single button instead of a switcher: shows the current language
 * and expands the list of all available ones on click.
 *
 * The list is positioned relative to the window (position: fixed), not
 * the parent. Otherwise the sidebar's `overflow: hidden` clips it, which
 * is exactly why the menu used to appear cut off.
 */
export default function LangMenu({ lang, setLang, up = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);

  // compute coordinates after rendering, to know the menu's real height
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const b = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight || 132;
    const w = menu.current?.offsetWidth || 158;

    // vertically: up or down, but not past the screen edge
    let top = up ? b.top - h - 6 : b.bottom + 6;
    if (top < 8) top = b.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, b.top - h - 6);

    // horizontally: align to the button, but keep it on screen
    let left = up ? b.left : b.right - w;
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);

    setPos({ top, left });
  }, [open, up]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (btn.current?.contains(e.target) || menu.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    // on scroll the menu detaches from the button, so close it
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const current = LANGS.find((l) => l.id === lang) || LANGS[0];

  return (
    <>
      <button ref={btn} className="tgl tgl-sm" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open} title={current.label}>
        {current.short}
      </button>

      {open && (
        <ul ref={menu} className="langmenu" role="listbox"
          style={pos ? { top: pos.top, left: pos.left } : { opacity: 0, top: -9999, left: -9999 }}>
          {LANGS.map((l) => (
            <li key={l.id}>
              <button role="option" aria-selected={l.id === lang}
                className={l.id === lang ? "on" : ""}
                onClick={() => { setLang(l.id); setOpen(false); }}>
                <span className="code">{l.short}</span>
                <span>{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

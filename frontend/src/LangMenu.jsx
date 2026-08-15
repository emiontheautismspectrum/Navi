import { useState, useRef, useEffect } from "react";
import { LANGS } from "./i18n.js";

/** Одна кнопка вместо переключателя: показывает текущий язык,
 *  по клику раскрывает список всех доступных. */
export default function LangMenu({ lang, setLang, up = false }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = LANGS.find((l) => l.id === lang) || LANGS[0];

  return (
    <div className="langbox" ref={box}>
      <button className="tgl tgl-sm" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open} title={current.label}>
        {current.short}
      </button>
      {open && (
        <ul className={`langmenu ${up ? "up" : ""}`} role="listbox">
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
    </div>
  );
}

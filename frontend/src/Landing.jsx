import { useState, useRef } from "react";
import { Mark, ICONS, UI } from "./Brand.jsx";
import { T } from "./i18n.js";
import LangMenu from "./LangMenu.jsx";

const AGENT_BLURB = {
  ru: {
    student: "Объясняет задания, находит сроки и требования, сжимает длинные тексты до сути.",
    teacher: "Быстрый просмотр учебных и организационных материалов, выделение важных фрагментов.",
    admin: "Обобщает внутренние документы и ускоряет повседневную работу с информацией.",
  },
  en: {
    student: "Explains assignments, finds deadlines and requirements, condenses long texts.",
    teacher: "Quick review of teaching and organisational materials, key fragments highlighted.",
    admin: "Summarises internal documents and speeds up daily information work.",
  },
};

export default function Landing({ lang, setLang, theme, setTheme, onEnter }) {
  const t = T[lang];
  const roles = ["student", "teacher", "admin"];
  const logoRef = useRef(null);
  // логотип перебирает цвета агентов при наведении — как при
  // переключении ролей внутри системы
  const [hoverAgent, setHoverAgent] = useState("student");
  const cycle = useRef(null);

  function startCycle() {
    const order = ["student", "teacher", "admin"];
    let i = 0;
    cycle.current = setInterval(() => {
      i = (i + 1) % order.length;
      setHoverAgent(order[i]);
    }, 520);
  }
  function stopCycle() {
    clearInterval(cycle.current);
    setHoverAgent("student");
  }

  // запуск системы: анимация расходится из самого логотипа
  function launch() {
    const r = logoRef.current?.getBoundingClientRect();
    onEnter(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }

  return (
    <div className="landing">
      <nav className="nav">
        <Mark agent="student" size={28} />
        <span className="name">Navi</span>
        <span className="sp" />
        <LangMenu lang={lang} setLang={setLang} />
        <button className="tgl tgl-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Light" : "Dark"}>
          {theme === "dark" ? UI.sun : UI.moon}
        </button>
        <button ref={logoRef} className="logo-launch" data-agent={hoverAgent}
          onMouseEnter={startCycle} onMouseLeave={stopCycle} onClick={launch}
          title={t.enter} aria-label={t.enter}>
          <Mark agent={hoverAgent} size={34} />
        </button>
      </nav>

      <section className="hero-sec">
        <div className="wrap">
          <p className="eyebrow reveal">{t.tagline}</p>
          <h1 className="h1 reveal" style={{ animationDelay: "60ms", marginTop: 16 }}>
            {t.heroA} <b>{t.heroB}</b>
          </h1>
          <p className="lead reveal" style={{ animationDelay: "120ms" }}>{t.heroSub}</p>
          <div className="hero-actions reveal" style={{ animationDelay: "180ms" }}>
            <button className="btn btn-primary" onClick={launch}>{t.enter}</button>
            <button className="btn btn-ghost" onClick={launch}>{t.tryFree}</button>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">01</p>
          <h2 className="h2">{t.problemTitle}</h2>
          <p className="lead">{t.problemText}</p>
          <div className="stats">
            {t.stats.map(([big, small]) => (
              <div className="stat" key={small}><b>{big}</b><span>{small}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">02</p>
          <h2 className="h2">{t.agentsTitle}</h2>
          <p className="lead">{t.agentsLead}</p>
          <div className="agent-cards">
            {roles.map((r) => (
              <div className="agent-card" key={r} data-agent={r}
                style={{ borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)" }}>
                <div className="ic" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }}>
                  {ICONS[r]}
                </div>
                <h3>{t.agents[r]}</h3>
                <p>{AGENT_BLURB[lang][r]}</p>
                <p style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--accent)" }}>
                  {t.access[r]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">03</p>
          <h2 className="h2">{t.howTitle}</h2>
          <div className="steps">
            {t.steps.map(([title, text], i) => (
              <div className="step" key={title}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <h4>{title}</h4>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="safety">
            <p className="eyebrow">04</p>
            <h2 className="h2" style={{ marginTop: 14 }}>{t.safetyTitle}</h2>
            <p>{t.safetyText}</p>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">05</p>
          <h2 className="h2">{t.featuresTitle}</h2>
          <div className="feats">
            {t.features.map(([h, p]) => (
              <div className="feat" key={h}><h4>{h}</h4><p>{p}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 20 }}>
        <div className="wrap">
          <div className="cta">
            <h2 className="h2">{t.ctaTitle}</h2>
            <p className="lead" style={{ margin: "0 auto 28px" }}>{t.ctaText}</p>
            <button className="btn btn-primary" onClick={launch}>{t.enter}</button>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="foot">
          <p style={{ margin: 0 }}>{t.footer}</p>
          <p style={{ margin: "10px 0 0" }}>Navi · NEXUS30 · 2026</p>
        </div>
      </div>
    </div>
  );
}

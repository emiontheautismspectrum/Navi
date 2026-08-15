import { useState, useEffect, useRef, Fragment } from "react";
import { Mark, ICONS, UI } from "./Brand.jsx";
import { T, PROMPTS, AGENTS } from "./i18n.js";
import * as api from "./api.js";

const DEMO_CODE = "demo";

/** История хранится отдельно для каждого университетского ID:
 *  разные люди на одном компьютере не видят диалоги друг друга. */
const histKey = (uid) => `navi:history:${uid || "guest"}`;

function loadHistory(uid) {
  try {
    const raw = localStorage.getItem(histKey(uid));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object"
      ? { guest: [], student: [], teacher: [], admin: [], ...parsed }
      : { guest: [], student: [], teacher: [], admin: [] };
  } catch {
    return { guest: [], student: [], teacher: [], admin: [] };
  }
}

function saveHistory(uid, data) {
  try {
    localStorage.setItem(histKey(uid), JSON.stringify(data));
  } catch {
    /* приватный режим или переполнение — не критично */
  }
}

export default function Chat({ lang, setLang, theme, setTheme, onHome }) {
  const t = T[lang];

  const [account, setAccount] = useState(null);
  const [agent, setAgent] = useState("guest");
  const [byAgent, setByAgent] = useState(() => loadHistory(null));
  const [docs, setDocs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rail, setRail] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [modal, setModal] = useState(false);
  const [uid, setUid] = useState("");
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const [openSrc, setOpenSrc] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [recording, setRecording] = useState(false);

  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const audioRef = useRef(null);
  const recRef = useRef(null);

  const turns = byAgent[agent] || [];
  const isGuest = agent === "guest";

  // история переключается вместе с учётной записью
  useEffect(() => { setByAgent(loadHistory(account?.id)); }, [account]);
  useEffect(() => { saveHistory(account?.id, byAgent); }, [byAgent, account]);

  useEffect(() => {
    let dead = false;
    api.listDocuments(agent)
      .then((d) => { if (!dead) setDocs(Array.isArray(d) ? d : []); })
      .catch(() => { if (!dead) setDocs([]); });
    return () => { dead = true; };
  }, [agent, account]);

  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth <= 860;
      setNarrow(n);
      if (n) setRail(true);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length, loading]);

  function push(turn) {
    setByAgent((p) => ({ ...p, [agent]: [...(p[agent] || []), turn] }));
  }
  function patchLast(patch) {
    setByAgent((p) => {
      const list = [...(p[agent] || [])];
      list[list.length - 1] = { ...list[list.length - 1], ...patch };
      return { ...p, [agent]: list };
    });
  }

  function login() {
    if (uid.trim() && code.trim().toLowerCase() === DEMO_CODE) {
      setAccount({ id: uid.trim() });
      setAgent("student");
      setModal(false);
      setUid(""); setCode(""); setBad(false);
    } else setBad(true);
  }

  function logout() { setAccount(null); setAgent("guest"); }

  function pick(id) {
    if (id !== "guest" && !account) { setModal(true); return; }
    setAgent(id);
    if (narrow) setRail(true);
  }

  async function send(preset) {
    const text = (preset ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);

    const history = turns.flatMap((x) =>
      x.answer ? [{ role: "user", content: x.question }, { role: "assistant", content: x.answer }] : []
    );
    push({ question: text, answer: null, sources: [], error: null });

    try {
      const data = await api.chat(agent, text, history, lang);
      patchLast({ answer: data.reply, sources: data.sources || [] });
    } catch (e) {
      patchLast({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  // Загруженный документ и суммаризируется, и остаётся в библиотеке роли
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || loading) return;
    if (isGuest) { setModal(true); return; }

    const text = await file.text();
    push({ question: `${t.uploaded}: ${file.name}`, answer: null, sources: [], error: null });
    setLoading(true);
    try {
      const [sum] = await Promise.all([
        api.summarizeText(agent, text, lang),
        api.uploadDocument(agent, file.name.replace(/\.[^.]+$/, ""), text, account?.id || "")
          .catch(() => null),
      ]);
      patchLast({ answer: sum.summary, note: t.addedToLibrary });
      api.listDocuments(agent).then(setDocs).catch(() => {});
    } catch (err) {
      patchLast({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function summarizeDoc(doc) {
    if (loading) return;
    push({ question: `${t.summarizeDoc}: ${doc.title}`, answer: null, sources: [], error: null });
    setLoading(true);
    if (narrow) setRail(true);
    try {
      const data = await api.summarizeDocument(agent, doc.id, lang);
      patchLast({ answer: data.summary, sources: [{ id: doc.id, title: doc.title, score: 1, excerpt: doc.preview }] });
    } catch (e) {
      patchLast({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function listen(idx, text) {
    if (playing === idx) {
      if (audioRef.current) audioRef.current.pause();
      setPlaying(null);
      return;
    }
    try {
      const url = await api.speak(text, lang);
      if (audioRef.current) audioRef.current.pause();
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => setPlaying(null);
      await a.play();
      setPlaying(idx);
    } catch (e) {
      alert(e.message);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current && recRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        try {
          const text = await api.transcribe(new Blob(parts, { type: "audio/webm" }), lang);
          if (text.trim()) send(text);
        } catch (e) {
          alert(e.message);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert(lang === "ru" ? "Нет доступа к микрофону" : "Microphone access denied");
    }
  }

  async function sendTicket(question) {
    try {
      await api.createTicket(agent, question, account?.id || "", account?.id || "");
      patchLast({ note: t.ticketSent });
    } catch (e) {
      alert(e.message);
    }
  }

  const composer = (
    <div className="box">
      <textarea value={input} rows={1}
        placeholder={isGuest ? t.placeholderGuest : t.placeholder}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <div className="box-actions">
        <button className={`icon-btn ${recording ? "live" : ""}`} onClick={toggleRecord}
          disabled={loading} title={recording ? t.recording : t.record}>{UI.mic}</button>
        <button className="icon-btn" onClick={() => fileRef.current?.click()}
          disabled={loading} title={t.attach}>{UI.clip}</button>
        <input ref={fileRef} type="file" accept=".txt,.md" style={{ display: "none" }} onChange={onFile} />
        <button className="send" onClick={() => send()} disabled={loading || !input.trim()}>{UI.send}</button>
      </div>
    </div>
  );

  const [h1, h2] = t.hero[agent];

  return (
    <div className="shell" data-agent={agent}>
      {narrow && !rail && <div className="scrim" onClick={() => setRail(true)} />}

      <aside className={`sidebar ${rail ? "rail" : ""}`}>
        <button className="side-brand" onClick={onHome} title={t.back}>
          <Mark agent={agent} size={28} />
          <span className="on-panel">
            <h1>Navi</h1>
            <span>{t.modeLabel}</span>
          </span>
        </button>

        <p className="side-label on-panel">{t.modeLabel}</p>
        <div className="agents">
          {AGENTS.map((id) => {
            const locked = id !== "guest" && !account;
            return (
              <button key={id} className={`agent ${agent === id ? "on" : ""} ${locked ? "locked" : ""}`}
                onClick={() => pick(id)} title={locked ? t.login : t.agents[id]}>
                <span className="ic">{ICONS[id]}</span>
                <span className="on-panel">{t.agents[id]}</span>
                {locked && <span className="lk on-panel">{UI.lock}</span>}
              </button>
            );
          })}
        </div>

        <div className="access on-panel">
          <b>{t.accessTitle}</b>
          {t.access[agent]}
        </div>

        <div className="lib scrollcol on-panel">
          <p className="side-label">{t.docs}{docs.length > 0 && ` · ${docs.length}`}</p>
          {docs.length === 0
            ? <p className="empty-note">{t.docsEmpty}</p>
            : docs.map((d) => (
                <button key={d.id} className="li" title={d.preview}
                  onClick={() => summarizeDoc(d)} disabled={loading}>{d.title}</button>
              ))}
        </div>

        <div className="hist scrollcol on-panel">
          <p className="side-label">{t.history}</p>
          {turns.length === 0
            ? <p className="empty-note">{t.historyEmpty}</p>
            : turns.map((x, i) => <button key={i} className="li trunc" title={x.question}>{x.question}</button>)}
        </div>

        <div className="side-foot">
          <div className="toggles">
            <button className="tgl" onClick={() => setLang(lang === "ru" ? "en" : "ru")}>{lang === "ru" ? "EN" : "RU"}</button>
            <button className="tgl" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? UI.sun : UI.moon}</button>
          </div>
          <button className="collapse" onClick={() => setRail((v) => !v)}>{UI.chevron}</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="pill"><i />{t.agents[agent]}</span>
          <span className="sp" />
          {account
            ? <><span className="who">{account.id}</span><button className="btn btn-ghost" onClick={logout}>{t.logout}</button></>
            : <button className="btn btn-primary" onClick={() => setModal(true)}>{t.login}</button>}
        </div>

        <div className="scroll" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="center">
              <h2 className="reveal">{h1} <b>{h2}</b></h2>
              <div className="reveal" style={{ animationDelay: "90ms", width: "100%", display: "flex", justifyContent: "center" }}>
                {composer}
              </div>
              <div className="chips reveal" style={{ animationDelay: "150ms" }}>
                {PROMPTS[lang][agent].map((q) => (
                  <button key={q} className="chip" onClick={() => send(q)} disabled={loading}>{q}</button>
                ))}
              </div>
              {isGuest && (
                <p className="note reveal" style={{ animationDelay: "210ms" }}>
                  {t.guestNote[0]}<button onClick={() => setModal(true)}>{t.guestNote[1]}</button>{t.guestNote[2]}
                </p>
              )}
            </div>
          ) : (
            <div className="thread">
              {turns.map((x, i) => (
                <div className="turn" key={i}>
                  <h2 className="q">{x.question}</h2>

                  {x.sources?.length > 0 && (
                    <>
                      <div className="lbl"><b>{t.sources}</b></div>
                      <div className="srcs">
                        {x.sources.map((sc, j) => {
                          const k = `${i}-${j}`;
                          const open = openSrc === k;
                          return (
                            <Fragment key={sc.id || j}>
                              <button className={`src ${open ? "open" : ""}`} onClick={() => setOpenSrc(open ? null : k)}>
                                <span className="n">{String(j + 1).padStart(2, "0")}</span>
                                <span className="t">{sc.title}</span>
                                <div className="bar"><i style={{ width: `${Math.min(100, Math.round(sc.score * 220))}%` }} /></div>
                                <span className="rel">{t.relevance} {sc.score}</span>
                                {sc.excerpt && <span className="more">{open ? t.hideFragment : t.showFragment}</span>}
                              </button>
                              {open && sc.excerpt && <div className="exc"><b>{t.fragment}</b>{sc.excerpt}</div>}
                            </Fragment>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="lbl"><b>{t.answer}</b></div>
                  {x.error ? <p className="err">{x.error}</p>
                    : x.answer ? (
                      <>
                        <div className="ans">{x.answer}</div>
                        <div className="turn-actions">
                          <button className="mini" onClick={() => listen(i, x.answer)}>
                            {playing === i ? UI.stop : UI.sound}
                            {playing === i ? t.stopListen : t.listen}
                          </button>
                          <button className="mini" onClick={() => sendTicket(x.question)} disabled={x.note === t.ticketSent}>
                            {UI.ticket}{x.note === t.ticketSent ? t.ticketSent : t.ticket}
                          </button>
                          {x.note && x.note !== t.ticketSent && (
                            <span className="mini" style={{ borderColor: "transparent", color: "var(--accent)" }}>{x.note}</span>
                          )}
                        </div>
                      </>
                    )
                    : <div className="think"><i /><i /><i /> {t.thinking}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {turns.length > 0 && (
          <div className="footer-in">
            {composer}
            <p className="disc">{t.disclaimer}</p>
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <h3>{t.modalTitle}</h3>
            <p className="lead2">{t.modalLead}</p>
            <div className="field">
              <label htmlFor="uid">{t.fieldId}</label>
              <input id="uid" value={uid} autoComplete="username"
                onChange={(e) => { setUid(e.target.value); setBad(false); }}
                onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
            <div className="field">
              <label htmlFor="code">{t.fieldCode}</label>
              <input id="code" type="password" value={code} autoComplete="current-password"
                onChange={(e) => { setCode(e.target.value); setBad(false); }}
                onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
            {bad && <p className="bad">{t.bad}</p>}
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 6, padding: 12 }} onClick={login}>{t.submit}</button>
            <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setModal(false)}>{t.cancel}</button>
            <p className="hint">{t.hint}</p>
          </div>
        </div>
      )}
    </div>
  );
}

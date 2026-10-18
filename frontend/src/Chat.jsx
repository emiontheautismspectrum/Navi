import { useState, useEffect, useRef, Fragment } from "react";
import { Mark, ICONS, UI } from "./Brand.jsx";
import { T, PROMPTS, AGENTS } from "./i18n.js";
import * as api from "./api.js";
import LangMenu from "./LangMenu.jsx";

// Demo account. In production the check moves to the side of
// the university's SSO; here it only exists to demonstrate the flow.
const DEMO_ID = "idnavi";
const DEMO_CODE = "demo";

/** History is stored separately for each university ID:
 *  different people on one computer do not see each other's dialogs. */
const histKey = (uid) => `navi:history:${uid || "guest"}`;

/** Uploaded documents are also stored in the browser under the same ID.
 *  The server keeps them in memory and loses them on restart (on the free
 *  Render tier it sleeps after 15 minutes of inactivity), so on the next
 *  visit the documents are restored from here. */
const docsKey = (uid) => `navi:docs:${uid || "guest"}`;
const MAX_DOC_CHARS = 200000;

function loadLocalDocs(uid) {
  try {
    const raw = localStorage.getItem(docsKey(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocalDoc(uid, doc) {
  try {
    const all = loadLocalDocs(uid).filter((d) => d.client_id !== doc.client_id);
    all.push(doc);
    localStorage.setItem(docsKey(uid), JSON.stringify(all));
  } catch {
    /* storage overflow: the document simply will not survive a revisit */
  }
}

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
    /* private mode or overflow: not critical */
  }
}

export default function Chat({ lang, setLang, theme, setTheme, onHome }) {
  const t = T[lang] || T.ru;

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
  const [tab, setTab] = useState("lib");   // lib | hist
  const [dragging, setDragging] = useState(false);
  const [freshDoc, setFreshDoc] = useState(null);   // highlight of the new document
  const dragDepth = useRef(0);
  const [playing, setPlaying] = useState(null);
  const [recording, setRecording] = useState(false);

  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const audioRef = useRef(null);
  const recRef = useRef(null);

  const turns = byAgent[agent] || [];
  const isGuest = agent === "guest";

  // history switches together with the account
  useEffect(() => { setByAgent(loadHistory(account?.id)); }, [account]);
  useEffect(() => { saveHistory(account?.id, byAgent); }, [byAgent, account]);

  useEffect(() => {
    let dead = false;

    async function sync() {
      // First send back to the server the documents saved in the browser.
      // Re-sending is safe: the server recognizes them by client_id
      // and creates no copies.
      if (account && agent !== "guest") {
        const mine = loadLocalDocs(account.id).filter((d) => d.role === agent);
        for (const d of mine) {
          try {
            await api.uploadDocument(agent, d.title, d.content, account.id, d.client_id);
          } catch { /* server unavailable: show what we have */ }
          if (dead) return;
        }
      }
      try {
        const list = await api.listDocuments(agent);
        if (!dead) setDocs(Array.isArray(list) ? list : []);
      } catch {
        if (!dead) setDocs([]);
      }
    }

    sync();
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
  // Deleting a single entry. Indexes shift after deletion, so we reset
  // the expanded passage, otherwise someone else's source would open.
  function removeTurn(idx) {
    setOpenSrc(null);
    setByAgent((p) => ({ ...p, [agent]: (p[agent] || []).filter((_, i) => i !== idx) }));
  }

  function clearHistory() {
    if (!(byAgent[agent] || []).length) return;
    if (!window.confirm(t.confirmClear)) return;
    setOpenSrc(null);
    setByAgent((p) => ({ ...p, [agent]: [] }));
  }

  function patchLast(patch) {
    setByAgent((p) => {
      const list = [...(p[agent] || [])];
      list[list.length - 1] = { ...list[list.length - 1], ...patch };
      return { ...p, [agent]: list };
    });
  }

  function login() {
    if (uid.trim().toLowerCase() === DEMO_ID && code.trim().toLowerCase() === DEMO_CODE) {
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

  // An uploaded document is both summarized and kept in the role's library.
  // Only text formats are read. PDF and DOCX would be read as binary
  // garbage and end up in the index, so we reject them immediately.
  const TEXT_EXT = [".txt", ".md", ".csv", ".markdown", ".log"];

  async function handleFile(file) {
    if (!file || loading) return;
    if (isGuest) { setModal(true); return; }

    const name = file.name.toLowerCase();
    const okType = TEXT_EXT.some((e) => name.endsWith(e)) || file.type.startsWith("text/");
    if (!okType) {
      push({ question: `${t.uploaded}: ${file.name}`, answer: null, sources: [], error: t.badFormat });
      return;
    }

    const text = await file.text();
    const title = file.name.replace(/\.[^.]+$/, "");
    const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    push({ question: `${t.uploaded}: ${file.name}`, answer: null, sources: [], error: null });
    setLoading(true);
    // Summarization and adding to the library are independent operations.
    // Previously an upload error was swallowed and the system still wrote
    // "added to the library" although the document was not there.
    let uploadErr = null;
    const doc = await api
      .uploadDocument(agent, title, text, account?.id || "", clientId)
      .catch((e) => { uploadErr = e; return null; });

    if (doc?.id) {
      if (text.length <= MAX_DOC_CHARS) {
        saveLocalDoc(account?.id, { client_id: clientId, role: agent, title, content: text });
      }
      // update the list right away, without waiting for summarization
      try {
        setDocs(await api.listDocuments(agent));
      } catch { /* the list will update on the next agent switch */ }
      setFreshDoc(doc.id);
      setTab("lib");
      setTimeout(() => setFreshDoc(null), 4000);
    }

    try {
      const sum = await api.summarizeText(agent, text, lang);
      patchLast({
        answer: sum.summary,
        note: doc?.id ? t.addedToLibrary : null,
        warn: uploadErr ? `${t.notAdded}: ${uploadErr.message}` : null,
      });
    } catch (err) {
      patchLast({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    handleFile(file);
  }

  // The counter is needed because dragleave bubbles up from nested elements:
  // without it the highlight flickers when the cursor moves inside the window.
  function onDragEnter(e) {
    e.preventDefault();
    dragDepth.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setDragging(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
  }
  function onDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFile(e.dataTransfer?.files?.[0]);
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
        <input ref={fileRef} type="file" accept=".txt,.md,.csv,.markdown,.log,text/*" style={{ display: "none" }} onChange={onFile} />
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

        {/* Library and history are tabs: one is open and gets the full
            height. Previously the two lists shared the space and both were clipped. */}
        <div className="panel on-panel">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "lib"}
              className={`tab ${tab === "lib" ? "on" : ""}`} onClick={() => setTab("lib")}>
              {t.docs}{docs.length > 0 && <em>{docs.length}</em>}
            </button>
            <button role="tab" aria-selected={tab === "hist"}
              className={`tab ${tab === "hist" ? "on" : ""}`} onClick={() => setTab("hist")}>
              {t.history}{turns.length > 0 && <em>{turns.length}</em>}
            </button>
          </div>

          <div className="panel-body scrollcol">
            {tab === "lib" ? (
              docs.length === 0
                ? <p className="empty-note">{t.docsEmpty}</p>
                : docs.map((d) => (
                    <button key={d.id} className={`li ${freshDoc === d.id ? "fresh" : ""}`} title={d.preview}
                      onClick={() => summarizeDoc(d)} disabled={loading}>{d.title}</button>
                  ))
            ) : turns.length === 0 ? (
              <p className="empty-note">{t.historyEmpty}</p>
            ) : (
              <>
                {turns.map((x, i) => (
                  <div className="hist-row" key={i}>
                    <button className="li trunc" title={x.question}>{x.question}</button>
                    <button className="del" onClick={() => removeTurn(i)} title={t.del} aria-label={t.del}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                ))}
                <button className="clear-all" onClick={clearHistory}>{t.clearAll}</button>
              </>
            )}
          </div>
        </div>

        <div className="side-foot">
          <div className="toggles">
            <LangMenu lang={lang} setLang={setLang} up />
            <button className="tgl" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? UI.sun : UI.moon}</button>
          </div>
          <button className="collapse" onClick={() => setRail((v) => !v)}>{UI.chevron}</button>
        </div>
      </aside>

      <div className="main"
        onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave} onDrop={onDrop}>
        {dragging && (
          <div className="dropzone">
            <div className="dropzone-inner">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
              </svg>
              <p>{isGuest ? t.guestUpload : t.dropHere}</p>
            </div>
          </div>
        )}
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
                {(PROMPTS[lang] || PROMPTS.ru)[agent].map((q) => (
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
                          {x.warn && (
                            <span className="mini warn" title={x.warn}>{x.warn}</span>
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

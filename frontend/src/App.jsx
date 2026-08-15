import React, { useRef, useState } from "react";
import { sendChatMessage, summarizeText } from "./api.js";

const ROLES = [
  { id: "student", label: "Студент" },
  { id: "teacher", label: "Преподаватель" },
  { id: "admin", label: "Админ. сотрудник" },
];

const ROLE_HINTS = {
  student: "Спросите про задание, срок сдачи или попросите объяснить тему",
  teacher: "Спросите про учебный план, регламент или попросите суммаризацию",
  admin: "Спросите про регламент, процедуру или срок рассмотрения заявления",
};

export default function App() {
  const [role, setRole] = useState("student");
  // история хранится отдельно на каждую роль — демонстрирует, что
  // агенты изолированы друг от друга
  const [historyByRole, setHistoryByRole] = useState({
    student: [],
    teacher: [],
    admin: [],
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const messages = historyByRole[role];

  function appendMessage(targetRole, msg) {
    setHistoryByRole((prev) => ({
      ...prev,
      [targetRole]: [...prev[targetRole], msg],
    }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    appendMessage(role, userMsg);
    setInput("");
    setLoading(true);

    try {
      // В истории могут лежать служебные сообщения об ошибках (role: "error").
      // Их обязательно нужно отфильтровать: backend принимает только
      // "user"/"assistant", иначе после первой же ошибки все последующие
      // запросы этой роли будут падать с 422 до перезагрузки страницы.
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      const data = await sendChatMessage(role, text, history);
      appendMessage(role, {
        role: "assistant",
        content: data.reply,
        sources: data.sources,
      });
    } catch (e) {
      appendMessage(role, { role: "error", content: e.message });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();

    appendMessage(role, {
      role: "user",
      content: `📄 Загружен документ «${file.name}» — запрос на суммаризацию`,
    });
    setLoading(true);
    try {
      const data = await summarizeText(role, text);
      appendMessage(role, { role: "assistant", content: data.summary, sources: [] });
    } catch (err) {
      appendMessage(role, { role: "error", content: err.message });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">NEXUS30 · EdTech · Yandex track</p>
        <h1>Экосистема AI-агентов университета</h1>
        <nav className="role-tabs">
          {ROLES.map((r) => (
            <button
              key={r.id}
              className={`role-tab ${role === r.id ? "active" : ""}`}
              onClick={() => setRole(r.id)}
            >
              {r.label}
            </button>
          ))}
        </nav>
        <p className="disclaimer">
          Ответы агента носят справочно-рекомендательный характер и не
          являются официальным решением, приказом или позицией
          университета. По вопросам, требующим официального решения,
          обращайтесь в соответствующее подразделение.
        </p>
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-state">{ROLE_HINTS[role]}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
            {m.role === "assistant" && m.sources && m.sources.length > 0 && (
              <div className="sources">
                источники:
                {m.sources.map((s) => (
                  <span key={s.id}>
                    {s.title} — релевантность {s.score}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="typing">агент печатает…</div>}
      </main>

      <div className="composer">
        <button
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Загрузить документ для суммаризации"
        >
          + документ
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите сообщение агенту…"
          rows={1}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          Отправить
        </button>
      </div>
    </div>
  );
}

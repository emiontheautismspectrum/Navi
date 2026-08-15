import React, { useRef, useState } from "react";
import { sendChatMessage, summarizeText } from "./api.js";

const ROLES = [
  { id: "student", label: "Студент" },
  { id: "teacher", label: "Преподаватель" },
  { id: "admin", label: "Админ. сотрудник" },
];

// Что именно доступно роли — показываем до первого вопроса.
// Разграничение доступа это суть системы, поэтому оно должно быть
// видно в интерфейсе, а не только проявляться в ответах.
const ROLE_ACCESS = {
  student: "Доступ: силлабусы, задания, регламенты для студентов",
  teacher: "Доступ: учебные планы, методические материалы кафедры",
  admin: "Доступ: внутренние регламенты, документооборот деканата",
};

// Готовые вопросы: человек, открывший ссылку впервые, может начать
// в один клик, не придумывая формулировку.
const ROLE_PROMPTS = {
  student: [
    "Когда сдавать курсовой проект по базам данных?",
    "Как подать апелляцию по результатам экзамена?",
    "Что нужно сделать в задании №5?",
  ],
  teacher: [
    "Что в методических рекомендациях кафедры?",
    "Какие сроки проведения сессии?",
    "Кратко изложи учебный план курса",
  ],
  admin: [
    "Сколько рассматривается заявление на академический отпуск?",
    "Как регистрируются входящие заявления студентов?",
    "Какие общие правила расписания сессии?",
  ],
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

  async function handleSend(presetText) {
    const text = (presetText ?? input).trim();
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
        <p className="role-access">{ROLE_ACCESS[role]}</p>
        <p className="disclaimer">
          Ответы агента носят справочно-рекомендательный характер и не
          являются официальным решением, приказом или позицией
          университета. По вопросам, требующим официального решения,
          обращайтесь в соответствующее подразделение.
        </p>
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-state__lead">С чего начать</p>
            <div className="prompt-chips">
              {ROLE_PROMPTS[role].map((q) => (
                <button
                  key={q}
                  className="prompt-chip"
                  onClick={() => handleSend(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
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
        <button onClick={() => handleSend()} disabled={loading || !input.trim()}>
          Отправить
        </button>
      </div>
    </div>
  );
}

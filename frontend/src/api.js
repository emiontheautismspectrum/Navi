const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/**
 * FastAPI отдаёт detail либо строкой (наши HTTPException), либо массивом
 * объектов (ошибки валидации pydantic, код 422). Без этой нормализации
 * массив попадал бы в Error() как "[object Object]" — пользователь видел бы
 * нечитаемое сообщение вместо причины сбоя.
 */
function formatError(err, status) {
  const detail = err?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.join(".") : "";
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  return `Ошибка сервера: ${status}`;
}

export async function sendChatMessage(role, message, history) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, message, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatError(err, res.status));
  }
  return res.json();
}

export async function summarizeText(role, text) {
  const res = await fetch(`${API_BASE}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatError(err, res.status));
  }
  return res.json();
}

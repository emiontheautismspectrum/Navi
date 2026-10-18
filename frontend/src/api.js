const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/** FastAPI returns detail as a string or an array (validation). Without
 *  normalization the array would turn into "[object Object]". */
function formatError(err, status) {
  const d = err && err.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join("; ");
  return `Ошибка сервера: ${status}`;
}

async function req(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(formatError(e, res.status));
  }
  return res;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const chat = (role, message, history, lang) =>
  req("/chat", json({ role, message, history, lang })).then((r) => r.json());

export const summarizeText = (role, text, lang) =>
  req("/summarize", json({ role, text, lang })).then((r) => r.json());

export const listDocuments = (role) =>
  req(`/documents?role=${role}`).then((r) => r.json());

export const summarizeDocument = (role, doc_id, lang) =>
  req("/summarize_document", json({ role, doc_id, lang })).then((r) => r.json());

export const uploadDocument = (role, title, content, uploaded_by, client_id) =>
  req("/documents/upload", json({ role, title, content, uploaded_by, client_id })).then((r) => r.json());

export const createTicket = (role, question, contact, uploaded_by) =>
  req("/ticket", json({ role, question, contact, uploaded_by })).then((r) => r.json());

/** Text-to-speech for the answer. Returns an objectURL for <audio>. */
export async function speak(text, lang) {
  const res = await req("/tts", json({ text, lang }));
  return URL.createObjectURL(await res.blob());
}

/** Speech recognition for a spoken question. */
export async function transcribe(blob, lang) {
  const fd = new FormData();
  fd.append("audio", blob, "question.webm");
  fd.append("lang", lang);
  const res = await req("/stt", { method: "POST", body: fd });
  return (await res.json()).text || "";
}

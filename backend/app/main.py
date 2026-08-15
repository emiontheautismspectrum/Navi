import os

from dotenv import load_dotenv

load_dotenv()  # ВАЖНО: до импорта app.llm_client, иначе LLM_PROVIDER и ключи
# из .env не успеют попасть в окружение к моменту первого запроса

from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agents import get_system_prompt
from app.data.documents import add_document, find_by_client_id, get_documents_for_role
from app.llm_client import call_llm
from app.rag import retriever

app = FastAPI(title="NEXUS30 EdTech — University AI Agents")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # для хакатон-демо; в проде сузить до домена фронтенда
    allow_methods=["*"],
    allow_headers=["*"],
)

Role = Literal["guest", "student", "teacher", "admin"]
Lang = Literal["ru", "en", "uz"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    role: Role
    message: str
    history: Optional[List[ChatMessage]] = None
    lang: Lang = "ru"


class SourceDoc(BaseModel):
    id: str
    title: str
    score: float
    excerpt: str = ""   # фрагмент, на котором построен ответ


class ChatResponse(BaseModel):
    reply: str
    sources: List[SourceDoc]


EN_INSTRUCTION = (
    "\n\nIMPORTANT: The user interface is in English. Answer in English, "
    "even though these instructions are written in Russian. Keep document "
    "titles in their original language."
)


def _excerpt(text: str, limit: int = 340) -> str:
    """Короткий фрагмент документа для показа в карточке источника.
    Обрезаем по границе предложения, чтобы не рвать слова."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "! ", "? "):
        idx = cut.rfind(sep)
        if idx > limit * 0.5:
            return cut[: idx + 1]
    return cut.rsplit(" ", 1)[0] + "…"


def _with_lang(prompt: str, lang: str) -> str:
    """Ответ на языке интерфейса: промпты написаны по-русски, поэтому
    для английского добавляем явную инструкцию."""
    return prompt + EN_INSTRUCTION if lang == "en" else prompt


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    # 1) Ролевой RAG-поиск по документам, доступным именно этой роли
    retrieved = retriever.retrieve(req.role, req.message, top_k=3)
    context_block = "\n\n".join(
        f"[Документ: {doc['title']}]\n{doc['content']}" for doc, _score in retrieved
    )

    system_prompt = _with_lang(get_system_prompt(req.role), req.lang)
    if context_block:
        system_prompt += (
            "\n\nНиже приведены фрагменты документов, найденные по запросу "
            "пользователя. Используй их как основной источник фактов. Если "
            "их недостаточно для ответа — прямо скажи об этом.\n\n"
            f"{context_block}"
        )

    # 2) Собираем историю диалога для контекста
    messages = []
    if req.history:
        for m in req.history[-10:]:  # ограничиваем окно для скорости демо
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": req.message})

    try:
        reply_text = call_llm(system_prompt, messages, max_tokens=800)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Ошибка LLM API: {e}")

    sources = [
        SourceDoc(
            id=doc["id"],
            title=doc["title"],
            score=round(float(score), 3),
            excerpt=_excerpt(doc["content"]),
        )
        for doc, score in retrieved
    ]
    return ChatResponse(reply=reply_text, sources=sources)


class SummarizeRequest(BaseModel):
    role: Role
    text: str
    lang: Lang = "ru"


class SummarizeResponse(BaseModel):
    summary: str


@app.post("/summarize", response_model=SummarizeResponse)
def summarize(req: SummarizeRequest):
    """Суммаризация произвольного текста «на лету» (загруженный документ)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Пустой текст")

    system_prompt = _with_lang(get_system_prompt(req.role), req.lang) + (
        "\n\nСейчас твоя единственная задача — сжато и структурно "
        "суммаризировать текст, который передаст пользователь. Выдели "
        "3-6 ключевых пунктов списком."
    )

    try:
        summary_text = call_llm(
            system_prompt,
            [{"role": "user", "content": req.text[:12000]}],
            max_tokens=500,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Ошибка LLM API: {e}")

    return SummarizeResponse(summary=summary_text)


class DocItem(BaseModel):
    id: str
    title: str
    preview: str


@app.get("/documents", response_model=List[DocItem])
def documents(role: Role):
    """Документы, доступные этой роли.

    У guest список пуст: неавторизованный пользователь не видит ни
    одного внутреннего документа — это то же разграничение, что и в
    поиске, только на уровне витрины.
    """
    docs = get_documents_for_role(role) if role != "guest" else []
    return [
        DocItem(id=d["id"], title=d["title"], preview=_excerpt(d["content"], 160))
        for d in docs
    ]


class DocSummaryRequest(BaseModel):
    role: Role
    doc_id: str
    lang: Lang = "ru"


@app.post("/summarize_document", response_model=SummarizeResponse)
def summarize_document(req: DocSummaryRequest):
    """Краткое изложение внутреннего документа вуза.

    Доступ проверяется на сервере: документ ищется только среди
    доступных этой роли. Подставить чужой doc_id нельзя — он просто
    не найдётся, и ответ будет 404.
    """
    docs = get_documents_for_role(req.role) if req.role != "guest" else []
    doc = next((d for d in docs if d["id"] == req.doc_id), None)
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ недоступен для этой роли")

    system_prompt = _with_lang(get_system_prompt(req.role), req.lang) + (
        "\n\nСейчас твоя задача — сжато изложить документ университета. "
        "Выдели 3-6 ключевых пунктов списком: сроки, требования, "
        "ответственных, важные исключения. Пиши так, как нужно именно "
        "твоей роли."
    )

    try:
        summary_text = call_llm(
            system_prompt,
            [{"role": "user", "content": f"{doc['title']}\n\n{doc['content'][:12000]}"}],
            max_tokens=500,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Ошибка LLM API: {e}")

    return SummarizeResponse(summary=summary_text)


class UploadRequest(BaseModel):
    role: Role
    title: str
    content: str
    uploaded_by: str = ""
    client_id: str = ""   # идентификатор из браузера, чтобы не плодить дубли


@app.post("/documents/upload", response_model=DocItem)
def upload_document(req: UploadRequest):
    """Добавляет загруженный документ в библиотеку.

    Документ становится доступен той роли, которая его загрузила:
    материал студента не попадает в индекс администратора. Хранение
    в памяти — переживёт до перезапуска сервиса (см. README).
    """
    if req.role == "guest":
        raise HTTPException(status_code=403, detail="Для загрузки документов нужен вход")
    if not req.title.strip() or not req.content.strip():
        raise HTTPException(status_code=400, detail="Пустой документ")

    # Повторная синхронизация из браузера не должна создавать копию
    existing = find_by_client_id(req.client_id, req.role)
    if existing is not None:
        return DocItem(id=existing["id"], title=existing["title"],
                       preview=_excerpt(existing["content"], 160))

    doc = add_document(
        client_id=req.client_id[:64],
        title=req.title.strip()[:200],
        content=req.content.strip()[:40000],
        roles=[req.role],
        uploaded_by=req.uploaded_by[:80],
    )
    retriever.reindex(req.role)
    return DocItem(id=doc["id"], title=doc["title"], preview=_excerpt(doc["content"], 160))


# ─────────────────────────────────────────────────────────────────
# Голос: ElevenLabs через прокси
# Ключ живёт только на сервере — из браузера он недоступен.
# ─────────────────────────────────────────────────────────────────
import base64

import requests as _rq
from fastapi import Response, UploadFile, File, Form

ELEVEN_BASE = "https://api.elevenlabs.io/v1"
# Голос по умолчанию — многоязычный, читает и русский, и английский
DEFAULT_VOICE = os.getenv("ELEVEN_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")


class TTSRequest(BaseModel):
    text: str
    lang: Lang = "ru"


@app.post("/tts")
def tts(req: TTSRequest):
    """Озвучка текста ответа. Возвращает mp3."""
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Озвучка недоступна: ELEVENLABS_API_KEY не задан")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой текст")

    try:
        r = _rq.post(
            f"{ELEVEN_BASE}/text-to-speech/{DEFAULT_VOICE}",
            headers={"xi-api-key": key, "Content-Type": "application/json"},
            json={
                "text": text[:2500],
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.4, "similarity_boost": 0.75},
            },
            timeout=60,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs недоступен: {e}")

    if not r.ok:
        raise HTTPException(status_code=502, detail=f"ElevenLabs error {r.status_code}: {r.text[:300]}")
    return Response(content=r.content, media_type="audio/mpeg")


@app.post("/stt")
async def stt(audio: UploadFile = File(...), lang: str = Form("ru")):
    """Распознавание голосового вопроса. Возвращает текст."""
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Распознавание недоступно: ELEVENLABS_API_KEY не задан")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Пустая запись")

    try:
        r = _rq.post(
            f"{ELEVEN_BASE}/speech-to-text",
            headers={"xi-api-key": key},
            files={"file": (audio.filename or "audio.webm", data, audio.content_type or "audio/webm")},
            data={"model_id": "scribe_v1", "language_code": "rus" if lang == "ru" else "eng"},
            timeout=90,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs недоступен: {e}")

    if not r.ok:
        raise HTTPException(status_code=502, detail=f"ElevenLabs error {r.status_code}: {r.text[:300]}")
    return {"text": r.json().get("text", "")}


# ─────────────────────────────────────────────────────────────────
# n8n: события, на которые вешаются автоматизации
# Бэкенд только отправляет событие и не ждёт результата, поэтому
# недоступный n8n никогда не ломает основной сценарий.
# ─────────────────────────────────────────────────────────────────
def notify_n8n(event: str, payload: dict) -> None:
    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        return
    try:
        _rq.post(url, json={"event": event, "data": payload}, timeout=4)
    except Exception:
        pass  # автоматизация не критична для ответа пользователю


class TicketRequest(BaseModel):
    role: Role
    question: str
    contact: str = ""
    uploaded_by: str = ""


@app.post("/ticket")
def ticket(req: TicketRequest):
    """Заявка в деканат: когда агент не может ответить своими
    документами, вопрос уходит в n8n и превращается в тикет."""
    notify_n8n("ticket.created", {
        "role": req.role,
        "question": req.question[:2000],
        "contact": req.contact[:200],
        "user": req.uploaded_by[:80],
    })
    return {"status": "queued"}


@app.get("/voices")
def voices():
    """Список доступных голосов ElevenLabs — чтобы подобрать тот,
    который хорошо читает и русский, и английский. Выбранный ID
    прописывается в переменную ELEVEN_VOICE_ID."""
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY не задан")
    try:
        r = _rq.get(f"{ELEVEN_BASE}/voices", headers={"xi-api-key": key}, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs недоступен: {e}")
    if not r.ok:
        raise HTTPException(status_code=502, detail=f"ElevenLabs error {r.status_code}: {r.text[:300]}")
    return {
        "current": DEFAULT_VOICE,
        "voices": [
            {"id": v.get("voice_id"), "name": v.get("name"), "labels": v.get("labels", {})}
            for v in r.json().get("voices", [])
        ],
    }

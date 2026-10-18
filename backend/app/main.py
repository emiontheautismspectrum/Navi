import os

from dotenv import load_dotenv

load_dotenv()  # IMPORTANT: before importing app.llm_client, otherwise LLM_PROVIDER and the keys
# from .env will not reach the environment by the time of the first request

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
    allow_origins=["*"],  # fine for a hackathon demo; narrow to the frontend domain in production
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
    excerpt: str = ""   # the passage the answer is built on


class ChatResponse(BaseModel):
    reply: str
    sources: List[SourceDoc]


EN_INSTRUCTION = (
    "\n\nIMPORTANT: The user interface is in English. Answer in English, "
    "even though these instructions are written in Russian. Keep document "
    "titles in their original language."
)


def _excerpt(text: str, limit: int = 340) -> str:
    """A short document passage to show in the source card.
    Cut at a sentence boundary so words are not split."""
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
    """Reply in the interface language: the prompts are written in Russian,
    so an explicit instruction is added for English."""
    return prompt + EN_INSTRUCTION if lang == "en" else prompt


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    # 1) Role-based RAG search over the documents available to this role only
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

    # 2) Assemble the conversation history for context
    messages = []
    if req.history:
        for m in req.history[-10:]:  # limit the window to keep the demo fast
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
    """Summarize arbitrary text on the fly (an uploaded document)."""
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
    """Documents available to this role.

    The guest list is empty: an unauthenticated user sees no internal
    documents. This is the same separation as in search, just at the
    catalog level.
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
    """A brief summary of an internal university document.

    Access is checked on the server: the document is looked up only among
    those available to this role. A foreign doc_id cannot be substituted:
    it simply will not be found, and the response is 404.
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
    client_id: str = ""   # identifier from the browser, to avoid creating duplicates


@app.post("/documents/upload", response_model=DocItem)
def upload_document(req: UploadRequest):
    """Adds an uploaded document to the library.

    The document becomes available to the role that uploaded it:
    a student's material does not reach the administrator's index.
    Storage is in memory and lasts until the service restarts (see README).
    """
    if req.role == "guest":
        raise HTTPException(status_code=403, detail="Для загрузки документов нужен вход")
    if not req.title.strip() or not req.content.strip():
        raise HTTPException(status_code=400, detail="Пустой документ")

    # Re-syncing from the browser must not create a copy
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
# Voice: ElevenLabs via a proxy
# The key lives only on the server and is not accessible from the browser.
# ─────────────────────────────────────────────────────────────────
import base64

import requests as _rq
from fastapi import Response, UploadFile, File, Form

ELEVEN_BASE = "https://api.elevenlabs.io/v1"
# The default voice is multilingual and reads both Russian and English
DEFAULT_VOICE = os.getenv("ELEVEN_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")


class TTSRequest(BaseModel):
    text: str
    lang: Lang = "ru"


@app.post("/tts")
def tts(req: TTSRequest):
    """Text-to-speech for the answer. Returns mp3."""
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
    """Recognizes a spoken question. Returns text."""
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
# n8n: events that automations hook into
# The backend only sends the event and does not wait for a result, so
# an unavailable n8n never breaks the main flow.
# ─────────────────────────────────────────────────────────────────
def notify_n8n(event: str, payload: dict) -> None:
    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        return
    try:
        _rq.post(url, json={"event": event, "data": payload}, timeout=4)
    except Exception:
        pass  # automation is not critical for the user's answer


class TicketRequest(BaseModel):
    role: Role
    question: str
    contact: str = ""
    uploaded_by: str = ""


@app.post("/ticket")
def ticket(req: TicketRequest):
    """Request to the dean's office: when the agent cannot answer from its
    own documents, the question goes to n8n and becomes a ticket."""
    notify_n8n("ticket.created", {
        "role": req.role,
        "question": req.question[:2000],
        "contact": req.contact[:200],
        "user": req.uploaded_by[:80],
    })
    return {"status": "queued"}


@app.get("/voices")
def voices():
    """List of available ElevenLabs voices, to pick one that reads both
    Russian and English well. The chosen ID is set in the
    ELEVEN_VOICE_ID variable."""
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

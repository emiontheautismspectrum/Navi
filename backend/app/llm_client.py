"""
A single provider-independent entry point for calling an LLM.

Supported providers (switched with the LLM_PROVIDER variable in .env):
  - anthropic  — Claude API (paid, ~$5 minimum top-up)
  - yandex     — YandexGPT (the case partner, hackathons often give free promo codes)
  - gemini     — Google Gemini (free tier without a card, limit ~10 requests/min)
  - groq       — Groq (completely free, up to 14,400 requests/day, open models)

main.py only calls call_llm(...) and does not know which provider is behind it.
This is intentional, so the provider can be switched without editing main.py.
"""
import os
import requests

# Default model for each provider if MODEL_NAME is not set explicitly
_DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "yandex": "yandexgpt/latest",
    "gemini": "gemini-2.5-flash",
    "groq": "llama-3.3-70b-versatile",
}


def _normalize_messages(messages: list[dict]) -> list[dict]:
    """
    Brings the history into a form that all providers accept.

    Why this is needed: the Anthropic API requires roles to strictly alternate
    (user → assistant → user...) and the first message to be from the user.
    In practice the history breaks easily: if a request failed with an error,
    the user's message stays in the history without an assistant reply,
    and the next request goes out with two "user" messages in a row → error 400.
    This is especially likely on the Render free tier, where the first request
    after the service "wakes up" may not get through.

    So here we drop empty messages, merge consecutive messages of the same
    role, and cut off leading assistant messages.
    """
    cleaned = [
        m for m in messages
        if m.get("content") and str(m["content"]).strip()
        and m.get("role") in ("user", "assistant")
    ]

    # the history must start with the user
    while cleaned and cleaned[0]["role"] == "assistant":
        cleaned.pop(0)

    merged: list[dict] = []
    for m in cleaned:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1] = {
                "role": m["role"],
                "content": f"{merged[-1]['content']}\n\n{m['content']}",
            }
        else:
            merged.append({"role": m["role"], "content": m["content"]})
    return merged


def call_llm(system_prompt: str, messages: list[dict], max_tokens: int = 800) -> str:
    """
    messages: a list of [{"role": "user"|"assistant", "content": "..."}]
    Returns the answer text. On error raises a RuntimeError with a clear
    message, which main.py wraps in an HTTPException 502.

    LLM_PROVIDER is read here rather than at module level on import.
    This matters because load_dotenv() in main.py is called after this
    file is imported, and otherwise the environment variable would not
    have been loaded from .env by the time of the first request.
    """
    messages = _normalize_messages(messages)
    if not messages:
        raise RuntimeError("Пустая история сообщений после нормализации.")

    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()
    if provider == "anthropic":
        return _call_anthropic(system_prompt, messages, max_tokens)
    elif provider == "yandex":
        return _call_yandex(system_prompt, messages, max_tokens)
    elif provider == "gemini":
        return _call_gemini(system_prompt, messages, max_tokens)
    elif provider == "groq":
        return _call_groq(system_prompt, messages, max_tokens)
    else:
        raise RuntimeError(
            f"Неизвестный LLM_PROVIDER='{provider}'. "
            "Допустимые значения: anthropic, yandex, gemini, groq."
        )


# ---------------------------------------------------------------------------
# Anthropic (Claude API)
# ---------------------------------------------------------------------------
def _call_anthropic(system_prompt: str, messages: list[dict], max_tokens: int) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY не задан. Добавьте его в backend/.env."
        )
    import anthropic

    model = os.getenv("MODEL_NAME", _DEFAULT_MODELS["anthropic"])
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    )
    return "".join(block.text for block in response.content if block.type == "text")


# ---------------------------------------------------------------------------
# YandexGPT (Yandex Foundation Models)
# ---------------------------------------------------------------------------
def _call_yandex(system_prompt: str, messages: list[dict], max_tokens: int) -> str:
    api_key = os.getenv("YANDEX_API_KEY")
    folder_id = os.getenv("YANDEX_FOLDER_ID")
    if not api_key or not folder_id:
        raise RuntimeError(
            "YANDEX_API_KEY и/или YANDEX_FOLDER_ID не заданы. "
            "Добавьте их в backend/.env (см. .env.example)."
        )

    model = os.getenv("MODEL_NAME", _DEFAULT_MODELS["yandex"])
    model_uri = f"gpt://{folder_id}/{model}"

    yandex_messages = [{"role": "system", "text": system_prompt}]
    for m in messages:
        yandex_messages.append({"role": m["role"], "text": m["content"]})

    resp = requests.post(
        "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
        headers={
            "Authorization": f"Api-Key {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "modelUri": model_uri,
            "completionOptions": {
                "stream": False,
                "temperature": 0.4,
                "maxTokens": str(max_tokens),
            },
            "messages": yandex_messages,
        },
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(f"YandexGPT API error {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    try:
        return data["result"]["alternatives"][0]["message"]["text"]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Неожиданный формат ответа YandexGPT: {data}") from e


# ---------------------------------------------------------------------------
# Google Gemini
# ---------------------------------------------------------------------------
def _call_gemini(system_prompt: str, messages: list[dict], max_tokens: int) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY не задан. Добавьте его в backend/.env "
            "(получить ключ: https://aistudio.google.com/apikey)."
        )

    model = os.getenv("MODEL_NAME", _DEFAULT_MODELS["gemini"])
    # Gemini has no "system" role in the history; the assistant role is called "model"
    contents = []
    for m in messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {"maxOutputTokens": max_tokens},
        },
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts)
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Неожиданный формат ответа Gemini: {data}") from e


# ---------------------------------------------------------------------------
# Groq (free, OpenAI-compatible format)
# ---------------------------------------------------------------------------
def _call_groq(system_prompt: str, messages: list[dict], max_tokens: int) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY не задан. Добавьте его в backend/.env "
            "(получить ключ бесплатно: https://console.groq.com/keys)."
        )

    model = os.getenv("MODEL_NAME", _DEFAULT_MODELS["groq"])
    groq_messages = [{"role": "system", "content": system_prompt}]
    groq_messages.extend({"role": m["role"], "content": m["content"]} for m in messages)

    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": groq_messages,
            "max_tokens": max_tokens,
        },
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(f"Groq API error {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Неожиданный формат ответа Groq: {data}") from e

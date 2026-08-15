"""
Единая точка входа для вызова LLM, независимая от провайдера.

Поддерживаемые провайдеры (переключаются переменной LLM_PROVIDER в .env):
  - anthropic  — Claude API (платно, от ~$5 минимального пополнения)
  - yandex     — YandexGPT (партнёр кейса, часто бесплатные промокоды на хакатонах)
  - gemini     — Google Gemini (бесплатный тариф без карты, лимит ~10 запросов/мин)
  - groq       — Groq (полностью бесплатно, до 14 400 запросов/день, open-модели)

main.py вызывает только call_llm(...) и не знает, какой провайдер за ним стоит —
это сделано намеренно, чтобы можно было переключать провайдера без правок main.py.
"""
import os
import requests

# Модель по умолчанию для каждого провайдера, если MODEL_NAME не задан явно
_DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "yandex": "yandexgpt/latest",
    "gemini": "gemini-2.5-flash",
    "groq": "llama-3.3-70b-versatile",
}


def _normalize_messages(messages: list[dict]) -> list[dict]:
    """
    Приводит историю к виду, который принимают все провайдеры.

    Зачем это нужно: Anthropic API требует, чтобы роли строго чередовались
    (user → assistant → user...) и первым шло сообщение пользователя.
    На практике история легко ломается: если запрос упал с ошибкой,
    сообщение пользователя остаётся в истории без ответа ассистента,
    и следующий запрос уйдёт с двумя "user" подряд → ошибка 400.
    Особенно вероятно на бесплатном тарифе Render, где первый запрос
    после «пробуждения» сервиса может не дойти.

    Поэтому здесь: выбрасываем пустые сообщения, склеиваем подряд идущие
    сообщения одной роли и отрезаем ведущие сообщения ассистента.
    """
    cleaned = [
        m for m in messages
        if m.get("content") and str(m["content"]).strip()
        and m.get("role") in ("user", "assistant")
    ]

    # история должна начинаться с пользователя
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
    messages: список [{"role": "user"|"assistant", "content": "..."}]
    Возвращает текст ответа. При ошибке кидает RuntimeError с понятным
    сообщением — main.py оборачивает его в HTTPException 502.

    LLM_PROVIDER читается здесь, а не на уровне модуля при импорте —
    это важно, потому что load_dotenv() в main.py вызывается уже после
    импорта этого файла, и переменная окружения иначе не успела бы
    подгрузиться из .env к моменту первого запроса.
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
    # Gemini не различает "system" в истории — роль ассистента называется "model"
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
# Groq (бесплатный, OpenAI-совместимый формат)
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

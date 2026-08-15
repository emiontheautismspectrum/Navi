# NEXUS30 · EdTech: экосистема AI-агентов для университета

Прототип для трека **EdTech** (партнёр Yandex) хакатона NEXUS30.
Три ролевых AI-агента (студент / преподаватель / администратор),
каждый со своим доступом к документам и стилем ответа, поверх
RAG-пайплайна.

## Что уже готово

- **Backend (FastAPI)** — эндпоинты `/chat` и `/summarize`, ролевой
  RAG-поиск на TF-IDF, три system prompt'а с разграничением по роли,
  синтетический демо-корпус документов (8 шт.) университета.
- **Провайдер LLM переключаемый** (`app/llm_client.py`) — одной строкой
  `LLM_PROVIDER` в `.env` можно переключаться между `yandex`, `anthropic`,
  `gemini`, `groq` без правок кода. По умолчанию — `yandex`.
- **Frontend (React + Vite)** — чат-интерфейс с переключателем ролей,
  отдельная история диалога на каждую роль, отображение источников
  под ответом, загрузка файла для суммаризации «на лету».
- **Деплой на Render настроен** — `render.yaml` (Blueprint) поднимает
  backend и frontend одним деплоем, `backend/Procfile` задаёт команду
  запуска под динамический `$PORT` Render.
- Всё проверено живым запуском (не только импортом): backend поднят
  локально, RAG-изоляция по ролям протестирована честным сравнением
  (документ, видимый только `admin`, не находится под ролью `student`),
  все 4 LLM-провайдера дают понятную ошибку вместо краша при
  отсутствующем ключе, frontend собирается и `VITE_API_BASE` корректно
  встраивается в бандл (`npm run build` — успешно).

## Быстрый старт

### 1. Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # опционально
pip install -r requirements.txt
cp .env.example .env
# .env.example уже настроен на LLM_PROVIDER=yandex — впишите свои
# YANDEX_API_KEY и YANDEX_FOLDER_ID (см. секцию "Получение ключей" ниже)
uvicorn app.main:app --reload --port 8000
```

Backend поднимется на `http://localhost:8000`. Проверка:
`http://localhost:8000/health` → `{"status": "ok"}`.
Интерактивная документация API: `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # по умолчанию уже указывает на localhost:8000
npm run dev
```

Откройте `http://localhost:5173`.

## Как это устроено

```
frontend (React)  →  POST /chat {role, message, history}
                          │
                          ▼
backend (FastAPI)  →  RAG-поиск по документам ЭТОЙ роли (TF-IDF)
                          │
                          ▼
                    system prompt роли + найденный контекст
                          │
                          ▼
              app/llm_client.py → call_llm(...)
                          │
                          ▼
        LLM_PROVIDER=yandex → YandexGPT API → ответ + источники
        (или anthropic / gemini / groq — переключается в .env)
```

Разграничение доступа реализовано на уровне данных: у каждой роли —
свой TF-IDF индекс, построенный только по документам, помеченным этой
ролью в `backend/app/data/documents.py`. Агент физически не видит
документы чужой роли — это не просто ограничение в промпте.

## Получение ключей Yandex Cloud

1. Откройте консоль каталога: `https://console.yandex.cloud/folders/<ваш-folder-id>/dashboard`
   — `<ваш-folder-id>` в адресной строке и есть `YANDEX_FOLDER_ID`,
   отдельно искать не нужно.
2. В меню каталога → **Сервисные аккаунты** → **Создать сервисный аккаунт**.
3. Назначьте роль **`ai.languageModels.user`** (без неё будет 403 при
   вызове YandexGPT).
4. Зайдите в созданный аккаунт → **Создать новый ключ** → **Создать
   API-ключ** (не «авторизованный ключ» — это другой тип).
5. Скопируйте секретное значение сразу — второй раз посмотреть его в
   консоли будет нельзя. Это и есть `YANDEX_API_KEY`.
6. При активации сервиса Yandex Cloud может предложить привязать
   платёжный аккаунт — промокод покроет расходы сверху него. Если
   привязать карту невозможно, переключите `LLM_PROVIDER=groq` в
   `.env` — он работает полностью бесплатно без карты.

## Деплой на Render

В репозитории уже лежит `render.yaml` (Blueprint) — Render поднимет
backend и frontend по нему автоматически.

1. **Render Dashboard → New → Blueprint** → выберите этот репозиторий.
   Render найдёт `render.yaml` и создаст два сервиса: `navi-backend`
   (Python web service) и `navi-frontend` (статическая сборка).
2. После создания зайдите в **navi-backend → Environment** и впишите
   реальные `YANDEX_API_KEY` и `YANDEX_FOLDER_ID` — в `render.yaml` эти
   поля намеренно оставлены пустыми (`sync: false`), потому что файл
   публичный в репозитории и секреты в нём хранить нельзя.
3. Дождитесь первого деплоя backend, скопируйте его публичный адрес
   (вида `https://navi-backend-XXXX.onrender.com`).
4. Зайдите в **navi-frontend → Environment**, замените `VITE_API_BASE`
   на скопированный адрес, затем нажмите **Manual Deploy** у
   frontend, чтобы пересобрать бандл с правильным адресом (Vite
   встраивает переменные в момент сборки, а не во время выполнения —
   просто изменить значение в панели недостаточно, нужен пересбор).
5. **Важно для демо на сцене:** на бесплатном тарифе Render сервис
   «засыпает» после 15 минут без запросов и «просыпается» 30–60 секунд
   на первый запрос. Откройте фронтенд за 5–10 минут до питча, чтобы
   бэкенд был уже «разогрет» к моменту демо.

## Ограничение из кейса

В интерфейсе и в презентации явно подчеркните: ответы агента —
рекомендательные, не официальное решение вуза. Это уже зашито в
`agents.py` (`BASE_RULES`), но стоит показать это явно на демо
(например, отдельной плашкой в UI).

## Структура проекта

```
nexus30-edtech/
├── render.yaml               # Render Blueprint — деплой backend+frontend одним кликом
├── backend/
│   ├── Procfile               # команда запуска для Render ($PORT динамический)
│   ├── app/
│   │   ├── main.py            # FastAPI-приложение, эндпоинты
│   │   ├── agents.py          # system prompt'ы трёх ролей
│   │   ├── llm_client.py      # абстракция над провайдером (yandex/anthropic/gemini/groq)
│   │   ├── rag.py             # TF-IDF ролевой поиск
│   │   └── data/
│   │       └── documents.py   # синтетический демо-корпус
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx            # чат-интерфейс
    │   ├── api.js              # клиент к backend
    │   └── index.css           # дизайн-система
    ├── package.json
    └── .env.example
```

# Navi — быстрый старт (План 2: Render + Yandex Cloud, публичный деплой)

## Шаг 1 — Ключи Yandex Cloud

1. `https://console.yandex.cloud/folders/b1g7igl5pu3k2kv1ik2b/dashboard`
2. `YANDEX_FOLDER_ID` = `b1g7igl5pu3k2kv1ik2b` (виден в адресной строке)
3. Слева → **Сервисные аккаунты** → **Создать сервисный аккаунт**
4. Роль: **`ai.languageModels.user`**
5. В аккаунте → **Создать новый ключ** → **Создать API-ключ**
6. Скопируйте секрет сразу — это `YANDEX_API_KEY`

## Шаг 2 — Запушить на GitHub

```bash
git add .
git commit -m "Деплой на Render + провайдер YandexGPT"
git push
```

## Шаг 3 — Render Blueprint

1. render.com → активируйте промокод
2. **New → Blueprint** → выберите репозиторий
3. Render найдёт `render.yaml`, создаст `navi-backend` + `navi-frontend` → **Apply**

## Шаг 4 — Ключи в панель Render

**navi-backend → Environment** → впишите `YANDEX_API_KEY` и
`YANDEX_FOLDER_ID` из Шага 1 → **Save Changes**

## Шаг 5 — Связать frontend с backend

1. Скопируйте публичный URL `navi-backend`
2. **navi-frontend → Environment** → `VITE_API_BASE` = этот URL
3. **Save Changes** → затем **Manual Deploy → Deploy latest commit**
   (обязательно! иначе новый адрес не попадёт в сборку)

## Шаг 6 — Проверка

- `<backend URL>/health` → `{"status":"ok"}`
- Откройте `<frontend URL>` — рабочий чат с ролями

## Перед сценой

- Откройте оба адреса за 5–10 минут до питча (бесплатный тариф Render
  "засыпает" через 15 минут простоя, будится 30-60 сек)
- План Б: если Yandex откажет — в Render Environment смените
  `LLM_PROVIDER=groq`, впишите `GROQ_API_KEY`, Save — передеплоится
  за минуту без правок кода

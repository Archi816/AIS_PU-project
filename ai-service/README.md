# LEMS AI service — запуск у коллеги

Сервис получает ID оборудования и описание проблемы на английском, ищет документацию в общей Supabase и возвращает предварительный отчёт для техника. Доступны два режима поиска: `summary` (краткие выдержки) и `full` (полные выбранные источники). Провайдеры OpenRouter и Azure сохранены; автоматического переключения между ними нет.

## 1. Получить код и установить зависимости

В Visual Studio: **Git → Clone Repository**, URL `https://github.com/Archi816/AIS_PU-project.git`. Открой ветку с AI-сервисом (сейчас `feature/ai-service-setup`). После публикации изменений обнови её через Pull.

Установи Python 3.14 (64-bit), затем открой PowerShell в папке `AIS_PU-project/ai-service`:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.venv` — отдельное окружение с библиотеками именно этого проекта. Оно создаётся на каждом ноутбуке; копировать чужую `.venv` не нужно. Активация окружения не требуется: команды явно используют его Python.

## 2. Заполнить локальный .env

Через личный канал получи у владельца проекта:

- DATABASE_URL пользователя `lems_reader` для чтения общей Supabase;
- сертификат CA Supabase или скачай его в настройках проекта;
- ключ OpenRouter (либо создай свой);
- ключ доступа к AI-сервису, согласованный с C# backend.

Открой `.env` и заполни поля шаблона. Пример подключения к базе:

```dotenv
DATABASE_URL='postgresql://lems_reader.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=verify-full&sslrootcert=C:/Users/YOUR_NAME/Downloads/prod-ca-2021.crt'
MODEL_PROVIDER=openrouter
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
OPENROUTER_API_KEY=YOUR_KEY
LEMS_SERVICE_API_KEY=YOUR_SERVICE_KEY
RETRIEVAL_MODE=full
```

PROJECT_REF, пароль и хост копируй из переданной строки подключения. Путь `sslrootcert` замени на реальный путь сертификата **на своём ноутбуке**. Внутри пароля специальные символы должны быть URL-кодированы: например `/` → `%2F`, `@` → `%40`; если строка уже подготовлена, повторно кодировать её не надо.

`LEMS_SERVICE_API_KEY` — общий секрет между C# и Python, минимум 32 случайных символа. Если запускаешь оба backend у себя, новый ключ можно получить командой ниже и записать одно и то же значение в настройки обоих backend:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

`.env.example` — шаблон без секретов для Git. Реальные значения хранятся только в `.env`. Файл владельца `.env.admin` для обычного запуска не нужен.

## 3. Подготовить поиск и проверить через консоль

Один раз скачай локальную поисковую модель (~64 МБ файлов):

```powershell
.\.venv\Scripts\python.exe -m app.retrieval
```

Общая Supabase уже содержит оборудование и индекс полных документов. Создавать таблицы, скачивать руководства и повторять импорт на ноутбуке коллеги не нужно.

```powershell
# Только список устройств; языковая модель не вызывается
.\.venv\Scripts\python.exe -m app.console --list
# Ввести ID устройства и проблему; получить ответ
.\.venv\Scripts\python.exe -m app.console
```

Пример: ID `ARD-001`, проблема `Arduino IDE reports programmer is not responding during USB upload.`

Консоль показывает путь запроса, этапы и время. `report ready` означает успешную обработку. `Ctrl+C` отменяет запуск. На один запуск режим можно заменить флагом:

```powershell
.\.venv\Scripts\python.exe -m app.console --retrieval summary
.\.venv\Scripts\python.exe -m app.console --retrieval full
```

Режим по умолчанию берётся из `.env`. `--json` выводит JSON, а этапы остаются отдельно в stderr. Консоль использует ту же обработку, что HTTP API, но работает без сервера.

## 4. Подключить C# backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Открой http://127.0.0.1:8000/docs → **Authorize** → вставь `LEMS_SERVICE_API_KEY`. GET `/ready` проверяет базу, поиск и настройки без запроса к языковой модели. Затем отправь POST `/api/v1/maintenance/analyze`:

```json
{
  "ticket_id": "REQ-108",
  "equipment_id": "ARD-001",
  "problem_description": "Arduino IDE reports programmer is not responding during USB upload."
}
```

C# на этом же ноутбуке использует URL `http://127.0.0.1:8000` и заголовок `X-Service-Key`. Пример C# и описание ответа: [API_CONTRACT.md](API_CONTRACT.md). Frontend получает результат через основной backend; ключи провайдера и базы остаются в Python-сервисе.

`127.0.0.1` означает текущий компьютер. При запуске C# и Python на разных компьютерах нужен доступный адрес Python-хоста и настройка сети. Здесь описан запуск обоих backend на ноутбуке коллеги. После изменений `.env` или кода останови сервер через Ctrl+C и запусти снова.

## Настройки, ошибки и расходы

- `MODEL_PROVIDER=openrouter`: разрешены только модели с `:free`, автоматического перехода на платную нет. Каждый запрос отчёта расходует бесплатную квоту. Модель и стоимость запроса смотри в OpenRouter → Activity.
- `MODEL_PROVIDER=azure`: явный выбор альтернативы; заполни поля AZURE_OPENAI в `.env`. Такие запросы могут расходовать Azure-кредит.
- `CATALOG_UNAVAILABLE`: проверь активность Supabase, DATABASE_URL, пароль и путь сертификата.
- `RETRIEVAL_UNAVAILABLE`: проверь скачанные веса и режим. Для full нужна таблица document_chunks.
- `MODEL_UNAVAILABLE`: проверь ключ, доступность/квоту модели; ошибка также возможна при некорректном ответе провайдера.
- `UNAUTHORIZED`: ключ X-Service-Key не совпал с настройкой Python.

`documentation_status=unavailable` сейчас означает, что нет выбранных процитированных источников: документы могли не подойти или модель не поставила ссылки. Отчёт тогда помечается как основанный на общих знаниях. Даже наличие ссылки не гарантирует правильность диагноза — результат проверяет техник.

## Что хранится в проекте

| Файлы | Назначение |
|---|---|
| app/console.py, app/main.py | Консоль и HTTP API |
| app/model_service.py, app/schemas.py | Обработка, провайдеры и проверка ответа |
| app/catalog.py, app/database.py | Каталог и SQL-подключение |
| app/retrieval.py, app/embeddings.py | Выбор режима и общая локальная модель поиска |
| app/retrieval_summary.py, app/retrieval_full.py | Независимые варианты поиска |
| app/config.py, app/security.py | Настройки и доступ между backend |
| app/index_documents.py, data/full_sources.json | Обновление полных источников владельцем базы |
| data/equipment_seed.json, data/CATALOG.md | Начальные демонстрационные данные и их описание |

Источники, обновление индекса и удаление одного из режимов описаны в [RAG.md](RAG.md). Импортёр сохраняется для обслуживания документов; при обычном запуске он не вызывается. Поиск не распознаёт рисунки и схемы. Модели оборудования и их доступность — демонстрационные данные, а не подтверждённый инвентарь TUKE.

Без DATABASE_URL можно явно использовать локальную SQLite: `python -m app.catalog` создаёт каталог из seed; для full потребуется отдельно построить индекс по RAG.md. Основной командный вариант — общая Supabase.

## Перед Commit и Push

В Visual Studio → Git Changes проверь список файлов. `.env`, `.env.admin`, `.venv`, SQLite, скачанные документы, кеши и настройки IDE исключены из Git. Сертификат хранится вне репозитория. Оставь **Amend выключенным**, введи сообщение нового коммита, например `chore: prepare AI service for team handoff`, нажми Commit All, затем Push. После публикации коллега сможет получить код через Pull.

На новом компьютере нужны код из Git, локальные реквизиты, сертификат и скачанная поисковая модель. Автоматические тесты и завершённый скрипт миграции удалены; минимальная проверка работы — консоль и `/ready`. Docker пока отложен.

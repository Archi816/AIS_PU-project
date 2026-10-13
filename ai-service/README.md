# AI Maintenance Assistant

Python service within the shared Lab Equipment Management System (LEMS).

## Intended responsibility

Collect reported equipment symptoms, retrieve relevant
equipment documentation, and prepare a source-backed preliminary report for a technician.
The technician confirms the diagnosis and repair actions. Reports are always in
English; missing evidence is listed in missing_information, without a chat reply.

## Current status

The initial FastAPI service exposes `GET /health` and interactive API documentation
at `/docs`. OpenRouter is the default report provider; Azure remains an explicitly selected alternative. Credentials must be configured locally. A single-table SQLite catalog supplies short reviewed summaries, searched with a local English embedding model. See [SETUP_OPENROUTER.md](SETUP_OPENROUTER.md) for setup and limitations.
The initial analysis contract is implemented with validation and explicit model-unavailable
responses. See `API_CONTRACT.md` for payloads, limits, and integration behavior.
Database and authentication boundaries still require team agreement.

## Local development (Windows PowerShell)

Run these commands from the `ai-service` directory. Python 3.14 is the initial
development version. Create `.venv` with your installed Python if it does not exist.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.catalog
.\.venv\Scripts\python.exe -m app.retrieval
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/health. Expected response:

```json
{"status":"ok","service":"lems-ai-service"}
```

Open http://127.0.0.1:8000/docs to try the endpoint using **Try it out** and **Execute**.
Stop the server with Ctrl+C. The `/` path is not implemented and returns 404.
The docs UI loads its Swagger UI assets from a CDN, so it may require internet access.

`/health` only confirms that this process can answer requests; it does not claim
that a language model or database is connected. The server listens locally only.
`--reload` restarts it after code edits and is for development, not production.

## Files and concepts

- `app/__init__.py`: marks `app` as a Python package.
- `app/main.py`: creates the FastAPI application and declares its HTTP routes.
- `requirements.txt`: pinned library versions used for this initial setup.
- `.venv/`: local Python environment; excluded from Git.

FastAPI maps HTTP requests to Python functions. Uvicorn is the server that listens
for requests. In `app.main:app`, `app.main` means `app/main.py`, and the last `app`
is the application object inside that file. `GET` retrieves information; `/health`
is the route path. The Python dictionary is serialized to JSON for the caller.

## Work breakdown

| Task | Done when |
| --- | --- |
| AI-01: Set up Python service | Python environment, dependency configuration, startup instructions, and health endpoint work locally. |
| AI-02: Agree integration contract | Team agrees equipment identifiers, request/response fields, authentication, errors, and ownership of data. |
| AI-03: Implement one-way assistant | Real model integration accepts equipment context and symptoms, lists missing information, and returns a structured preliminary report; unavailable model returns an explicit error. |
| AI-04: Store reports | SQL migrations and persistence preserve reports, and links to equipment/request identifiers. |
| AI-05: Ingest equipment documentation | Documents are associated with equipment models; extracted text retains source, version, and section/page references. |
| AI-06: Add grounded recommendations | Retrieval filters by equipment model; reports cite retrieved sources and explicitly handle missing evidence. |
| AI-07: Evaluate and integrate | Documented cases check retrieval relevance, source support, missing information, access control, and the complete frontend/backend workflow. |
| AI-08: Package and deploy | Service runs in the agreed Docker setup and Azure environment with configured secrets and documented startup. |

These labels are planning identifiers, not GitHub issue numbers. No GitHub issues
have been created by adding this file. Implementation tasks may be refined after
agreement with the frontend, C# backend, and database owners.

## Collaboration

- Use short-lived branches per coherent task, followed by a pull request.
- Confirm whether the team integrates into `dev` or `wip` before opening a PR.
- Keep credentials, virtual environments, and IDE caches out of Git.
- Agree the API contract early; the Python implementation does not require knowledge
  of the internal C# implementation.
- Loading documents is retrieval preparation, not training a model. Confirm the
  course's ML assessment criteria with the instructor.

## Optional Azure provider

Set `MODEL_PROVIDER=azure` explicitly. The Azure deployment is `gpt-5-mini`. Copy `.env.example` to `.env` only if `.env`
does not already exist, then fill AZURE_OPENAI_API_KEY locally. Never commit `.env`.
The supplied base URL comes from Foundry Continue in code; it is not the project endpoint.
Environment variables override .env values. Settings are read at each request.

The service uses Responses API structured output, minimal reasoning, a 2000 output-token
cap, 60-second timeout, no automatic retries, and store=False. This is not a guarantee
of zero provider retention. Requests send catalog equipment name/model, problem description and reviewed summary;
ticket IDs are retained locally. Live web search is not enabled. Relevant excerpts are selected locally by equipment ID and English problem description.

Run the existing uvicorn command, then POST via /docs. Requests now consume Azure
model tokens when a real key is configured. This local API has no authentication yet;
keep it bound to 127.0.0.1 until team access controls are implemented.

Missing configuration, provider errors, refusals, incomplete or invalid output return
503 MODEL_UNAVAILABLE without exposing raw upstream errors. /health remains liveness-only.
Tests isolate credentials and use provider doubles; they never prove live Azure availability.
Run: `.\.venv\Scripts\python.exe -m unittest discover -s tests -v`.

## Local equipment catalog (start here)

SQLite is included with Python; no extra installation or cloud payment is needed.
From ai-service, run once on each developer machine:

```powershell
.\.venv\Scripts\python.exe -m app.catalog
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

The first command creates data/equipment.db from data/equipment_seed.json. It
preserves existing rows when repeated; edits to seed JSON do NOT overwrite an
existing database. The JSON is reviewed initial data shared in Git; the runtime
DB is ignored. To update a running catalog, edit its rows deliberately (no public
write endpoint is provided). LEMS_CATALOG_PATH in the process environment can
override the database path. Secrets stay in .env as before.

GET /api/v1/equipment lists seven fully populated demo items. Models, locations
and operational conditions are project assumptions, not verified TUKE inventory.
Every row has is_demo=true. Operational does not imply availability for booking.
See [the readable catalog](data/CATALOG.md) for all rows, summaries and sources.

POST /api/v1/maintenance/analyze now accepts:

```json
{
  "ticket_id": "REQ-106",
  "equipment_id": "ARD-001",
  "problem_description": "Arduino IDE reports avrdude: programmer is not responding when uploading."
}
```

Documentation summaries now cover all seven items: Dell OptiPlex 7090 Micro,
HP ProBook 450 G8, Creality Ender-3, TurtleBot3 Burger, Arduino UNO R3,
Raspberry Pi 4 Model B and Fluke 115.
Summaries are English paraphrases, not complete repair manuals. Manufacturer
facts and project triage policy are explicitly separated. URLs and review dates
are stored alongside the text in data/equipment_seed.json.

HP guidance is general PC diagnostics; the Fluke source is a product overview.
These are explicitly labelled in the summaries and are not model repair manuals.

After pulling changes, complete placeholders in an existing demo database with:

```powershell
.\.venv\Scripts\python.exe -m app.catalog --complete-demo
```

This fills missing models, placeholder locations and unknown conditions only for
matching demo records. Custom models, locations, conditions and existing document
text are preserved. Repeating is safe. To fill documentation only for already
matching models, use --fill-missing-docs instead.
New databases receive the updated seed immediately. No cloud calls are involved.

Sources reviewed 2026-10-15:
- Ender-3: https://store.creality.com/blogs/all/ender-3-extruder-skipping
  Limited extrusion and filament summary, not a V3 manual or repair procedure.
- TurtleBot3: https://emanual.robotis.com/docs/en/platform/turtlebot3/bringup/
  ROS 2 Humble/Jazzy topic discovery, model selection and version differences.
Arduino source/review date remain in the seed (2026-10-13).

Semantic search uses BAAI/bge-small-en-v1.5 through FastEmbed on CPU. It searches
only the selected item's reviewed English text, using overlapping 90-word windows.
At most three relevant excerpts go to one model call. Document vectors are cached
in memory by text content (up to 32 entries); they are rebuilt after a restart.
Weights are downloaded once with `python -m app.retrieval`; API requests load local
files only. No URL downloading, vector server or paid embedding API is used.

The current corpus is still short summaries, not full manuals. Similarity cutoff
0.48 is a heuristic, not a confidence probability; it needs broader evaluation as
we add documents. No matching excerpt means documentation_status=unavailable.
A broken embedding installation returns 503 RETRIEVAL_UNAVAILABLE instead.
Sources indicate supplied context, not verified citations for every model claim.
Reports remain preliminary and need technician review.

This SQLite file is a local first step, not the final two-database/container
architecture. Coordinate catalog ownership with the C# team. AWS PostgreSQL
migration requires replacing the catalog adapter and importing the data; do not
assume the SQLite file can be directly deployed as an RDS database.

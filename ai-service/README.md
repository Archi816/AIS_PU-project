# AI Maintenance Assistant

Python service within the shared Lab Equipment Management System (LEMS).

## Intended responsibility

Collect reported equipment symptoms, retrieve relevant
equipment documentation, and prepare a source-backed preliminary report for a technician.
The technician confirms the diagnosis and repair actions. Reports are always in
English; missing evidence is listed in missing_information, without a chat reply.

## Current status

The initial FastAPI service exposes `GET /health` and interactive API documentation
at `/docs`. Azure Responses API integration is implemented; live credentials must be configured locally. A single-table local SQLite equipment catalog supplies short reviewed summaries.
The initial analysis contract is implemented with validation and explicit model-unavailable
responses. See `API_CONTRACT.md` for payloads, limits, and integration behavior.
Database and authentication boundaries still require team agreement.

## Local development (Windows PowerShell)

Run these commands from the `ai-service` directory. Python 3.14 is the initial
development version. Create `.venv` with your installed Python if it does not exist.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
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

## Configure Azure locally

The Azure deployment is `gpt-5-mini`. Copy `.env.example` to `.env` only if `.env`
does not already exist, then fill AZURE_OPENAI_API_KEY locally. Never commit `.env`.
The supplied base URL comes from Foundry Continue in code; it is not the project endpoint.
Environment variables override .env values. Settings are read at each request.

The service uses Responses API structured output, minimal reasoning, a 2000 output-token
cap, 45-second timeout, no automatic retries, and store=False. This is not a guarantee
of zero provider retention. Requests send catalog equipment name/model, problem description and reviewed summary;
ticket IDs are retained locally. Live web search is not enabled. Short documentation is selected by equipment ID.

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

GET /api/v1/equipment lists seven demo items. Every item's condition is unknown
and location is unverified. Physical inventory, exact unknown models and lending
permissions must be verified with the lab; this is not an official TUKE register.
Arduino UNO R3 is a proposed kit configuration, not a verified TUKE asset model.

POST /api/v1/maintenance/analyze now accepts:

```json
{
  "ticket_id": "REQ-106",
  "equipment_id": "ARD-001",
  "problem_description": "Arduino IDE reports avrdude: programmer is not responding when uploading."
}
```

Only ARD-001 currently has reviewed troubleshooting text: a concise paraphrase of
Arduino Help Center's General troubleshooting checklist and Still need help:
https://support.arduino.cc/hc/en-us/articles/4401874331410--Error-avrdude-when-uploading
Reviewed 2026-10-13. The text concerns upload problems, not arbitrary board faults.
Other devices intentionally have no imported manual text yet. PRN-001 and ROB-001
have official reference links, but links alone are NOT documentation context.

All short reviewed text for the selected item is sent in one model call, capped
at 12000 characters. There is no keyword/embedding search, extra model call, or
automatic URL downloading. documentation_sources means material provided to the
model, not verified per-claim citations. Treat every report as preliminary.
For missing documents, only general observation/data collection is requested.
English and non-invasive advice are prompt requirements, not deterministic safety
or language guarantees; review actual reports before using them.

This SQLite file is a local first step, not the final two-database/container
architecture. Coordinate catalog ownership with the C# team. AWS PostgreSQL
migration requires replacing the catalog adapter and importing the data; do not
assume the SQLite file can be directly deployed as an RDS database.

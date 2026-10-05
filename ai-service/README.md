# AI Maintenance Assistant

Python service within the shared Lab Equipment Management System (LEMS).

## Intended responsibility

Collect reported equipment symptoms, ask clarification questions, retrieve relevant
equipment documentation, and prepare a source-backed preliminary report for a technician.
The technician confirms the diagnosis and repair actions.

## Current status

The initial FastAPI service exposes `GET /health` and interactive API documentation
at `/docs`. Model connection, database, chat, and retrieval are not implemented yet.
API and database boundaries require team agreement.

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
| AI-03: Implement assistant conversation | Real model integration accepts equipment context and symptoms, asks clarification questions, and returns a structured preliminary report; unavailable model returns an explicit error. |
| AI-04: Store conversations and reports | SQL migrations and persistence preserve messages, reports, and links to equipment/request identifiers. |
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

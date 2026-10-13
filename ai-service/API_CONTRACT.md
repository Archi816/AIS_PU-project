# Maintenance analysis API v1

Status: OpenRouter integration with local English semantic search is implemented; local credentials are required. Local development only;
authentication must be agreed with the team before deployment. No database writes.

## Request

`POST /api/v1/maintenance/analyze`, `Content-Type: application/json`

```json
{
  "ticket_id": "REQ-104",
  "equipment_id": "PRN-001",
  "problem_description": "The printer moves but no filament comes out."
}
```

All three fields are required strings. Whitespace is trimmed; blank strings, null,
numbers, and unknown fields are rejected. Maximum lengths: ticket_id 100,
equipment_id 100, problem_description 4000 characters. ticket_id is an opaque
identifier supplied by the main backend, not an ID created by this service.

## Successful responses (200, illustrative examples)

Only `result_type: report` is returned. All report text is in English, even for
non-English requests, but retrieval is optimized for English: send problem_description in English. The former clarification/questions response is removed;
clients should display missing_information instead.

```json
{
  "ticket_id": "REQ-104",
  "result_type": "report",
  "preliminary": true,
  "symptoms": ["The user reports movement without filament extrusion."],
  "possible_causes": [],
  "recommended_checks": [],
  "missing_information": ["Displayed error messages were not provided."],
  "documentation_status": "unavailable",
  "documentation_sources": []
}
```

These are interface examples, not generated diagnoses. Empty lists are
allowed when evidence is insufficient. A report always requires technician review.
documentation_sources lists reviewed summaries supplied to the model, not proof that
every hypothesis is supported. URLs come from the catalog, never the model.
Each source includes url, section and verified_at. An empty/unreviewed document
returns documentation_status: unavailable, even when a URL exists.

## Errors

Missing configuration or a model failure returns **503**. With valid provider settings, a valid request calls the model and may return 200:

```json
{
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "Сервис модели временно недоступен. Проверьте настройки подключения или повторите запрос позже."
  }
}
```

Invalid input returns **422** with the same envelope and `code: VALIDATION_ERROR`.
Clients should branch on the stable code, not the human-readable message.
Do not retry 422 automatically. Do not loop on 503; show the message and offer a
manual retry. Do not render errors as successful reports.

## Scope and integration

This API is one-way and stateless: one request produces one preliminary report.
Missing information is listed for the technician as statements, not questions.
Up to three relevant excerpts are selected from the equipment_id record by local English semantic search. No matching excerpt gives documentation_status=unavailable. The corpus currently contains short summaries, not full manuals.
No chat history or live web retrieval is connected.
The core backend remains responsible for checking the user's access to the ticket.
GET /health checks process liveness only, not model availability.

## Check locally

Run `python -m unittest discover -s tests -v` using this service's .venv interpreter.
The checks start their own local server on an available port and stop it afterward.

## Local catalog (breaking request change in service 0.5.0)

The request now requires equipment_id instead of equipment_model. The latter is
rejected as an unknown field. GET /api/v1/equipment lists the seven demo entries
and their documentation. Initialize with `python -m app.catalog` before use.
404 EQUIPMENT_NOT_FOUND means the selected ID is absent; no model call is made.
503 CATALOG_UNAVAILABLE means the database is missing, unreadable or the stored
summary exceeds 12000 characters; no model call is made.
The catalog is demonstration data, not a live TUKE inventory or lending policy.

## Service 0.6.0 integration notes

POST URL and successful response shape are unchanged. C# does not need provider
names or API keys. Send technical problem descriptions in English and do not
include student names, email addresses, credentials or confidential lab details.
Free NVIDIA provider terms include request logging; see SETUP_OPENROUTER.md.

503 RETRIEVAL_UNAVAILABLE means local model weights/dependencies are unavailable;
service operator must run the preparation command. Missing OpenRouter credentials,
rate limits, invalid JSON, provider refusals and timeouts use MODEL_UNAVAILABLE.
There are no automatic retries and no automatic paid-provider fallback.
Allow the backend HTTP client at least 75 seconds for the service's 60-second
provider timeout plus local search/processing; do not repeatedly resubmit on timeout.

For AWS, hosting the database alone is insufficient. The Python API also needs a
reachable HTTPS address, server-side secrets, service authentication and connection
settings for the chosen database. Do not expose this unauthenticated dev service.

# LEMS maintenance API — team integration (v0.7.0)

C# backend → Python service → model provider. Frontend talks to C#, which checks
student sessions, roles and permission to view/analyze the ticket. Do not put the
service key or provider credentials into browser code. No user impersonation or
conversation history is implemented here.

## Required configuration in C#

- AI service base URL (local: http://127.0.0.1:8000; shared: agreed HTTPS address).
- Private service key, matching LEMS_SERVICE_API_KEY on Python server.
- HttpClient timeout around 90 seconds (provider timeout is 60 seconds plus search).

```csharp
// Store these in server configuration / development user secrets, not source code.
var http = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
using var request = new HttpRequestMessage(HttpMethod.Post,
    configuration["AiService:BaseUrl"]!.TrimEnd('/') + "/api/v1/maintenance/analyze");
request.Headers.Add("X-Service-Key", configuration["AiService:ServiceKey"]!);
request.Content = System.Net.Http.Json.JsonContent.Create(new {
    ticket_id = "REQ-108",
    equipment_id = "ARD-001",
    problem_description = "Arduino IDE reports programmer is not responding during USB upload."
});
using var response = await http.SendAsync(request);
var body = await response.Content.ReadAsStringAsync();
// Inspect StatusCode: display report on 200, error.message otherwise.
// In the real application use an injected/reused HttpClient (IHttpClientFactory).
```

`localhost` means the computer executing C#. It does not refer to another student's
machine. Inside Docker use the agreed service DNS name. A database hosted in Supabase
alone does not make the Python service reachable.

## POST /api/v1/maintenance/analyze

Headers: Content-Type: application/json, X-Service-Key: private shared value.

```json
{
  "ticket_id": "REQ-108",
  "equipment_id": "ARD-001",
  "problem_description": "Arduino IDE reports programmer is not responding during USB upload."
}
```

All fields required, trimmed, nonblank strings; no unknown fields. Limits:
100 characters for IDs, 4000 for description. Send descriptions in English for the
English embedding model. Reports are instructed to be English; inspect model output.

Illustrative success (HTTP 200):

```json
{
  "ticket_id": "REQ-108",
  "result_type": "report",
  "preliminary": true,
  "symptoms": ["Upload fails."],
  "possible_causes": [],
  "recommended_checks": ["Review the selected board and serial port."],
  "missing_information": ["Full upload error was not provided."],
  "documentation_status": "provided",
  "documentation_sources": [{
    "url": "https://support.arduino.cc/hc/en-us/articles/4401874331410--Error-avrdude-when-uploading",
    "section": "Selected diagnostic topics; manufacturer summary and labelled project policy",
    "verified_at": "2026-10-27"
  }]
}
```

Render four list sections and source links. No follow-up questions are returned.
Lists can be empty. `documentation_status=unavailable` means no eligible relevant
context or no inline citations in full mode; it is not proof of a broken database. Sources come from the catalog, not
the model, and do not certify every hypothesis. Reports require technician review.
Do not render model text as unescaped HTML.

## Errors

All handled errors use `{"error":{"code":"...","message":"..."}}`.

| HTTP | code | Client action |
|---|---|---|
| 401 | UNAUTHORIZED | Check private service credential; do not retry automatically. |
| 404 | EQUIPMENT_NOT_FOUND | Correct equipment ID. |
| 422 | VALIDATION_ERROR | Correct input fields. |
| 503 | SERVICE_NOT_CONFIGURED | Operator must configure service access key. |
| 503 | CATALOG_UNAVAILABLE | Operator checks database / bounded document size. |
| 503 | RETRIEVAL_UNAVAILABLE | Operator prepares local embedding model. |
| 503 | MODEL_UNAVAILABLE | Provider config, quota, timeout, refusal or invalid JSON. |
| 503 | NOT_READY | /ready check failed. |

Use codes, not message text, for logic. Do not retry repeatedly: a timeout may
follow provider processing. Offer a manual retry. Neither provider is automatically
replaced by another; Azure is opt-in via server configuration.

## Other endpoints

- GET /health: public process-liveness check; no external calls.
- GET /ready: requires X-Service-Key; checks database, local encoder, provider config.
  Does not call provider or prove available quota (`live_provider_checked=false`).
- GET /api/v1/equipment: requires key; lists catalog records. No public write API.
- /docs and /openapi.json: development only; hidden with APP_ENV=production.

Successful POST schema remains compatible with 0.6.0. Version 0.7.0 adds required
service authentication. The core backend still owns user sessions and authorization.


### Retrieval modes

The POST input is unchanged. The server selects `RETRIEVAL_MODE=summary|full` (default summary if unset; the team .env.example selects full). Responses include `retrieval_mode`. Full mode returns only cited `documentation_sources`, with `source_id` (e.g. S1), `url`, `title`, `section`, `page` (PDF page or null), `excerpt` and `retrieved_at`. Inline `[S1]` markers refer to those sources. `verified_at` is empty for imported full documents; download/index date does not mean human verification. Summary sources keep their existing fields; new metadata fields are empty/null. No relevant cited passages means `documentation_status=unavailable` and explicitly general advice. A retrieval infrastructure failure returns 503 RETRIEVAL_UNAVAILABLE. See RAG.md.

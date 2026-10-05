# Maintenance analysis API v1

Status: agreed initial contract; model integration is pending. Local development only;
authentication must be agreed with the team before deployment. No database writes.

## Request

`POST /api/v1/maintenance/analyze`, `Content-Type: application/json`

```json
{
  "ticket_id": "REQ-104",
  "equipment_model": "Prusa MK4",
  "problem_description": "The printer moves but no filament comes out."
}
```

All three fields are required strings. Whitespace is trimmed; blank strings, null,
numbers, and unknown fields are rejected. Maximum lengths: ticket_id 100,
equipment_model 200, problem_description 4000 characters. ticket_id is an opaque
identifier supplied by the main backend, not an ID created by this service.

## Successful responses (200, contract examples only)

The frontend switches on `result_type`.

```json
{
  "ticket_id": "REQ-104",
  "result_type": "clarification",
  "questions": ["What error message, if any, is displayed?"]
}
```

```json
{
  "ticket_id": "REQ-104",
  "result_type": "report",
  "preliminary": true,
  "symptoms": ["The user reports movement without filament extrusion."],
  "possible_causes": [],
  "recommended_checks": []
}
```

These are interface examples, not generated diagnoses. Empty cause/check lists are
allowed when evidence is insufficient. A report always requires technician review.
Source citations will be added when the documentation/RAG contract is agreed.

## Errors

Currently every valid request returns **503**, because no model is connected:

```json
{
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "Сервис модели недоступен: подключение ещё не настроено."
  }
}
```

Invalid input returns **422** with the same envelope and `code: VALIDATION_ERROR`.
Clients should branch on the stable code, not the human-readable message.
Do not retry 422 automatically. Do not loop on 503; show the message and offer a
manual retry. Do not render errors as successful reports.

## Scope and integration

This first API is stateless: it does not save a chat or infer earlier messages from
ticket_id. For a follow-up, send the full updated problem_description containing the
previous symptoms and the user's answers. Dedicated history can be added later.
The core backend remains responsible for checking the user's access to the ticket.
GET /health checks process liveness only, not model availability.

## Check locally

Run `python -m unittest discover -s tests -v` using this service's .venv interpreter.
The checks start their own local server on an available port and stop it afterward.

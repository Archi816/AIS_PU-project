# OpenRouter + local semantic search

## What runs where

- Local CPU: FastEmbed + BAAI/bge-small-en-v1.5 selects English documentation excerpts.
- OpenRouter / NVIDIA: nvidia/nemotron-3.5-super-vl:free generates the report.
- SQLite: seven demo equipment records and reviewed short summaries.
- Frontend and C# keep the same POST request / response contract.

The NVIDIA endpoint listed zero input/output token prices and structured output
support when checked on 2026-10-27. Free availability and limits can change.
No paid fallback is configured; the adapter rejects model IDs without :free.
The free NVIDIA endpoint discloses request logging and use for product improvement.
Use non-confidential technical descriptions only; ticket IDs are not sent to it.
Automated tests use provider doubles. A live English Arduino report was verified on 2026-10-27. The former nemotron-3-super-120b-a12b:free entry was no longer listed; the configured replacement succeeded.

Sources:
- https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://qdrant.github.io/fastembed/
- https://huggingface.co/BAAI/bge-small-en-v1.5

## Configure on your machine

1. Create an OpenRouter API key at https://openrouter.ai/settings/keys.
2. Edit your existing ai-service/.env locally. Add/update these lines; do not
   overwrite existing Azure values. Never put a real key in .env.example or Git.

```dotenv
MODEL_PROVIDER=openrouter
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
OPENROUTER_API_KEY=replace-with-your-private-key
```

3. In PowerShell, inside ai-service:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.catalog
.\.venv\Scripts\python.exe -m app.retrieval
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The retrieval preparation downloads public model weights (approximately 64 MiB
of cached files in this installation). It makes no language-model API calls.
The server never downloads weights during requests. On this development machine
preparation has already completed; a colleague must run it on their machine.

4. Open http://127.0.0.1:8000/docs and POST /api/v1/maintenance/analyze:

```json
{
  "ticket_id": "REQ-107",
  "equipment_id": "ARD-001",
  "problem_description": "Arduino IDE reports avrdude: programmer is not responding during upload. The board is connected via USB."
}
```

Expected: 200 with an English preliminary report. 503 MODEL_UNAVAILABLE can mean
missing/invalid key, exhausted free quota, provider unavailability or invalid output.
It does not prove a database problem. 503 RETRIEVAL_UNAVAILABLE means prepare the
local embedding model or repair its dependencies. No paid model is tried on error.

## How the search works

1. Read the chosen equipment record. Other equipment cannot enter the search.
2. Split its reviewed text into 90-word windows with 20-word overlap.
3. Encode passages and the English problem as numeric vectors (embeddings).
4. Compare their direction (cosine similarity). Select at most three above 0.48.
5. Send selected text and the problem in one report request. Validate returned JSON.

The threshold is a starting heuristic, not a probability. Small smoke checks are
not an accuracy benchmark. Short existing summaries restrict the available evidence;
this change does not download or search complete manuals. Empty results use general
observation-only advice, never invented documentary support.

Document vectors are cached in process memory by content, so edits invalidate them
and restarts rebuild them. The encoder uses two CPU threads; one search runs at a
time per process. Start with one worker and measure memory before scaling.
Model weights/cache and local database files are excluded from Git.

## AWS next step (not deployed)

Await account type (personal / Academy), permitted services, region and budget.
Then agree SQL engine and catalog ownership with the team, migrate SQLite data,
and deploy the Python service with HTTPS and service-to-service authentication.
Keep credentials server-side, configure C# with the service URL and access secret.
The current dev server is deliberately local; do not publish port 8000 as-is.
AWS infrastructure costs are separate from free OpenRouter generation.

> **UNOFFICIAL DRAFT.** Full-stack prototype (C# backend + web UI + stand-in AI service). Not the official version.
> The AI service here (`ai-service-prototype/`, endpoint `/analyze`) is a stand-in and does **not** use the team's
> `feature/ai-service-setup` contract (`POST /api/v1/maintenance/analyze`). See "Integration with the team AI service" below.

# LEMS - Laboratory Equipment Management System

* `backend/` - C# (ASP.NET Core 8 minimal API, EF Core, **two databases**: Azure SQL + PostgreSQL, DB-backed **sessions**), also serves the web UI from `wwwroot/`
* `ai-service-prototype/` - Python (FastAPI) AI component: static repair recommendations for each problem report
* `backend/wwwroot/` - responsive SPA (vanilla JS, no build step)

## Run
```bash
# 1) AI component (optional but recommended; set ANTHROPIC_API_KEY to use Claude, otherwise a built-in rule engine is used)
cd ai-service-prototype && pip install -r requirements.txt && uvicorn main:app --port 8001

# 2) Backend + UI  (.NET 8 SDK)
cd backend && dotnet run        # http://localhost:5000 (Development profile)
```
Out of the box both databases are local SQLite files (`lems-core.db`, `lems-ops.db`) so it runs without any cloud account; tables are created and seeded on first start. If the AI service is down, reports are still created; the admin just sees "recommendations unavailable".

Demo accounts exist **only in the Development environment** (default for `dotnet run`). In production set `Seed__AdminEmail` / `Seed__AdminPassword` for the first admin and `Security__RequireHttps=true`.

Demo accounts: `admin@lems.local / Admin123!` and `jan.novak@student.tuke.sk / Student123!`.
Students self-register with `name.surname@student.tuke.sk` (name/surname are taken from the email).

## How the processes are implemented
| Process | Where |
|---|---|
| Login / registration / sessions | `Api.cs` (`Login`, `Register`), `Services/Security.cs` (PBKDF2 hashes, `ISession`) |
| Equipment create / update / delete (double confirmation in UI) | `Api.cs`, `wwwroot/app.js` |
| Booking: PENDING -> CONFIRMED -> IN_PROGRESS -> FINISHED, reject, cancel, 24h/start-time auto-cancel | `Api.cs`, `Services/Workers.cs` (`LifecycleWorker`, runs every 15 s) |
| MAINTENANCE cascade (cancels PENDING+CONFIRMED, releases slots, notifies) | `Services/Domain.cs` |
| Problem report -> AI analysis -> admin review -> repair -> close | `Api.cs` (`*Repair`), `Services/Workers.cs` (`AiClient`), `ai-service-prototype/main.py` |
| Dashboard feed, notifications (bell) | `Dashboard`, `ListNotifications` |

A slot is "blocked" by any booking of that equipment in `PENDING`, `CONFIRMED` or `IN_PROGRESS`; moving to `REJECTED`/`CANCELED`/`FINISHED` releases it automatically (no separate slot table). Booking creation is serialized with a lock, so the same slot can't be double booked.

## Inconsistencies found in the specification and how they were resolved
1. **Field sizes** (`email` 20, `name` 10, `location` 10 ...) cannot hold `name.surname@student.tuke.sk` -> enlarged (email 100, name/surname 50, location 20).
2. **`RepairRequest.status` is BOOL but described as OPEN/CLOSED** -> stored as enum `OPEN|CLOSED`. Added `confirmed` (admin confirmed the problem -> "in repair"), `resolution` (`RESOLVED` / `NO_REPAIR_REQUIRED`, diagram says "resolved without repair"), `ai_recommendations`, `created_at`.
3. **Equipment has no category/thumbnail but the UI needs a category filter** -> added `Equipment.category`; thumbnails are icons per category.
4. **Notifications and the activity feed have no tables** -> added `Notification` and `ActivityEvent` (minimal).
5. **Booking flowchart says "Equipment AVAILABLE?" but rules BR-BK-02/BR-GEN-01 allow `RESERVED`** -> rules win: only `MAINTENANCE` blocks booking (also re-checked on approval).
6. **Maintenance flowchart cancels `IN_PROGRESS` bookings, rules (BR-MT-02/08) don't; booking lifecycle lists `IN_PROGRESS -> CANCELED`, BR-CN-03 forbids it** -> `IN_PROGRESS` bookings are never canceled; they finish normally.
7. **Admin sidebar had no Equipment page but admins manage equipment there** -> admin also gets "Equipment".
8. **Admin can set any equipment status?** `RESERVED` is system-managed (driven by `IN_PROGRESS` bookings); admin can only switch `AVAILABLE <-> MAINTENANCE`. Leaving maintenance gives `RESERVED` if a booking is still in progress.
9. **Back-to-back bookings:** the worker finishes ending bookings *before* starting new ones, so equipment doesn't flicker to `AVAILABLE` wrongly.
10. **Several confirmed repair requests for one equipment:** equipment returns to service only after the *last* confirmed request is closed.
11. **"Repair failed" loop** modelled as the "Checked - still not working" action (request stays open, nothing changes).
12. **Deleting equipment** (BR-EQ-D-02: no checks) cascades to its bookings/repairs; affected students are only notified.
13. **Duplicate BR-GEN-06** - second one (external service) is respected: no external-service component or UI exists.
14. **Booking approval of an expired/non-PENDING request** returns an error; the worker also auto-cancels PENDING requests at 24 h or start time (BR-BK-15).
15. Booking `description` (purpose) is required; slots are 08:00-20:00 (configurable in `appsettings.json`). Times are server-local ("lab time").
16. Admins cannot book or report problems (BR-GEN-05 - students only). Students see only their own bookings/requests; AI recommendations are visible to admins only.

## Notes
* Tables are created with `EnsureCreated()` (no migrations) - delete the SQLite files (or drop the cloud tables) after schema changes.
* The development sandbox had no NuGet access: the C# code was compiled against a hand-written stand-in for the EF Core API (type-checks my code, not EF behaviour) and never run against real SQL Server/PostgreSQL. Expect to fix small provider-specific issues on first run.

## Authentication & session security
* Sessions live in the **database** (`UserSession`): cookie = random 256-bit token (HttpOnly, SameSite=Lax, Secure on HTTPS); DB stores only its SHA-256. They survive restarts, can be shared by several server instances, are revoked on logout, rotate on every login (no fixation), expire after 8 h idle / 24 h absolute, and the user's role is re-read from the DB on every request.
* CSRF: every state-changing `/api` call needs the `X-Requested-With: LEMS` header and a same-origin `Origin` (no CORS is enabled).
* Passwords: PBKDF2-SHA256, 600 000 iterations (old hashes are upgraded at login), min 8 chars with letter + digit, max 128; unknown emails take the same time as wrong passwords.
* Brute force: after 8 failed logins per email+IP (or 40 per IP) within 5 min the login is **temporarily** refused (429). Deviation from BR-AUTH-04 ("no limit on attempts"): there is no permanent lock-out, only a short cool-down. The counters are in memory (per instance).
* Security headers (CSP, nosniff, frame deny), `Cache-Control: no-store` on the API, HTTPS redirect + HSTS when `Security:RequireHttps` is true.
* Still not covered: password reset, e-mail verification, MFA.

## Two-database architecture (Azure SQL + PostgreSQL)
| Database | Engine | Tables |
|---|---|---|
| **Core** | Azure SQL (`CoreDb`) | `User`, `UserSession`, `Equipment` |
| **Ops** | PostgreSQL, e.g. AWS RDS (`OpsDb`) | `Booking`, `RepairRequest`, `Notification`, `ActivityEvent` |

`Booking.user_id/equipment_id`, `RepairRequest.created_by/equipment_id` and `Notification.user_id` point into Core but are **not foreign keys** (databases in two clouds cannot have them). The application joins the data in code (`Api.cs`: `EqMap`, `UserMap`).

**Switching to the cloud** - no code change, only configuration (see `backend/appsettings.Cloud.example.json`):
```bash
export Databases__Core__Provider=SqlServer  Databases__Core__ConnectionString="Server=tcp:...database.windows.net,1433;..."
export Databases__Ops__Provider=Postgres    Databases__Ops__ConnectionString="Host=...rds.amazonaws.com;..."
export Security__RequireHttps=true Seed__AdminEmail=... Seed__AdminPassword=...
```
`docker compose up -d` starts a local SQL Server and PostgreSQL to try this (connection strings are in the example file; use user `sa`/`lems` from `docker-compose.yml`). `GET /api/health` reports whether both databases are reachable.

### How consistency works without a shared transaction
1. **Ordered writes, truth first.** Equipment status lives in Core, so it is written first; Ops follows. Putting equipment into MAINTENANCE: save status (new bookings are refused at once) -> cancel PENDING/CONFIRMED bookings in Ops -> notify students.
2. **Idempotent steps.** Every multi-step action can be repeated safely (e.g. pressing "Confirm problem" again after a failure just finishes the missing part).
3. **Compensation.** A booking is inserted in Ops after checking Core; then the equipment status is re-read, and the booking is canceled if the equipment entered MAINTENANCE in between.
4. **Database-enforced slots.** A unique *filtered* index on `Booking(equipment_id, start_time)` for active statuses makes double booking impossible even with several servers. `Booking.status` is an optimistic-concurrency token, so an approval cannot silently overwrite a parallel cancellation.
5. **Derived state + reconciliation.** `LifecycleWorker` (every 15 s) recomputes each equipment's `RESERVED/AVAILABLE` status from Ops bookings and deletes Ops records of equipment that no longer exists in Core (replacing the cross-database cascade).
6. **Best effort only for the feed:** activity events are written after the Core change committed; if Ops is down at that moment the event can be lost (the change itself is not).

Known limits: no distributed transaction, so for a few seconds after a crash the two databases can disagree until the worker repairs it; the booking process lock and login throttle are per server instance (the database index and sessions already work across instances).

## Integration with the team AI service
The branch `feature/ai-service-setup` contains the team's AI service (`ai-service/`) with a different contract:
`POST /api/v1/maintenance/analyze` with `{ticket_id, equipment_id, problem_description}` returning a `report`
(symptoms, possible_causes, recommended_checks, missing_information, documentation_*). The backend's `AiClient`
(`backend/Services/Workers.cs`) currently calls the prototype's `POST /analyze` instead. To use the team's service,
adapt `AiClient.AnalyzeAsync` to the new request/response shape and handle its 422/503 error envelope.
This prototype lives in `ai-service-prototype/` so it does not collide with the team's `ai-service/` folder.

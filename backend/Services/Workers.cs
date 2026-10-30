using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Lems;

/// <summary>
/// Client for the team's Python AI service (ai-service/, contract: ai-service/API_CONTRACT.md v0.7.0).
/// POST {BaseUrl}/api/v1/maintenance/analyze with header X-Service-Key.
/// Always returns JSON text to store with the repair request:
///   { "ok": true,  "report": { ...the service's report... } }
///   { "ok": false, "code": "MODEL_UNAVAILABLE", "message": "..." }
/// Failures never break the main flow and are never retried automatically (the admin can re-run manually).
/// </summary>
public class AiClient(IHttpClientFactory factory, IConfiguration cfg, ILogger<AiClient> log)
{
    static string Fail(string code, string message) => JsonSerializer.Serialize(new { ok = false, code, message });

    public async Task<string> AnalyzeAsync(Equipment e, RepairRequest r)
    {
        var key = cfg["AiService:ServiceKey"];
        if (string.IsNullOrWhiteSpace(key))
            return Fail("SERVICE_NOT_CONFIGURED", "AiService:ServiceKey is not set in the backend configuration.");
        try
        {
            var client = factory.CreateClient("ai");
            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/maintenance/analyze");
            req.Headers.Add("X-Service-Key", key);
            req.Content = JsonContent.Create(new
            {
                ticket_id = $"REQ-{r.Id}",
                equipment_id = e.InventoryNumber,                      // must equal an ID in the AI service's equipment catalog
                problem_description = $"{r.Title}. {r.Description}"    // max 4000 characters, English works best
            });
            using var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(body);
                return JsonSerializer.Serialize(new { ok = true, report = doc.RootElement.Clone() });
            }
            // handled errors look like {"error":{"code":"...","message":"..."}}
            try
            {
                using var doc = JsonDocument.Parse(body);
                var err = doc.RootElement.GetProperty("error");
                return Fail(err.GetProperty("code").GetString() ?? "UNKNOWN", err.GetProperty("message").GetString() ?? "");
            }
            catch { return Fail($"HTTP_{(int)resp.StatusCode}", "Unexpected answer from the AI service."); }
        }
        catch (TaskCanceledException)
        {
            log.LogWarning("AI service timed out");
            return Fail("AI_TIMEOUT", "The AI service did not answer in time.");
        }
        catch (Exception ex)
        {
            log.LogWarning("AI service unreachable: {Msg}", ex.Message);
            return Fail("AI_UNREACHABLE", "The AI service could not be reached.");
        }
    }
}

/// <summary>Background worker: booking lifecycle (BR-BK-11/13/15), equipment status sync, session purge and
/// cross-database reconciliation. Runs every 15 s; every step is idempotent.</summary>
public class LifecycleWorker(IServiceScopeFactory scopes, IOptions<LemsOptions> opt, IOptions<SecurityOptions> sec, ILogger<LifecycleWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Tick(); }
            catch (Exception ex) { log.LogError(ex, "Lifecycle tick failed (will retry)"); }
            try { await Task.Delay(TimeSpan.FromSeconds(15), ct); } catch (TaskCanceledException) { }
        }
    }

    static async Task<Dictionary<int, Equipment>> EquipmentMap(CoreDb core, IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToList();
        return await core.Equipment.Where(e => list.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
    }

    public async Task Tick()
    {
        using var scope = scopes.CreateScope();
        var core = scope.ServiceProvider.GetRequiredService<CoreDb>();
        var ops = scope.ServiceProvider.GetRequiredService<OpsDb>();
        var d = new Domain(core, ops);
        var now = DateTime.Now;

        // 0. purge expired login sessions (Core)
        var utc = DateTime.UtcNow;
        var idleCutoff = utc.AddMinutes(-sec.Value.IdleMinutes);
        await core.UserSessions.Where(x => x.ExpiresAt < utc || x.LastSeenAt < idleCutoff).ExecuteDeleteAsync();

        // 1. PENDING: auto-cancel after 24 h or when the start time is reached (BR-BK-15)
        var pending = await ops.Bookings.Where(b => b.Status == BookingStatus.PENDING).ToListAsync();
        var expired = pending.Where(b => b.CreatedAt.AddHours(opt.Value.PendingTimeoutHours) <= now || b.StartTime <= now).ToList();
        if (expired.Count > 0)
        {
            var eq = await EquipmentMap(core, expired.Select(b => b.EquipmentId));
            foreach (var b in expired)
            {
                b.Status = BookingStatus.CANCELED;
                var title = eq.TryGetValue(b.EquipmentId, out var e) ? e.Title : "the equipment";
                d.Notify(b.UserId, $"Your booking request for {title} ({Domain.When(b)}) was canceled automatically because no decision was made in time.");
            }
            await ops.SaveChangesAsync();
        }

        // 2. IN_PROGRESS -> FINISHED (before starting new ones, so back-to-back bookings work)
        var ending = await ops.Bookings.Where(b => b.Status == BookingStatus.IN_PROGRESS && b.EndTime <= now).ToListAsync();
        foreach (var b in ending) b.Status = BookingStatus.FINISHED;

        // 3. CONFIRMED -> IN_PROGRESS when the start time has been reached
        var starting = await ops.Bookings.Where(b => b.Status == BookingStatus.CONFIRMED && b.StartTime <= now).ToListAsync();
        foreach (var b in starting) b.Status = b.EndTime <= now ? BookingStatus.FINISHED : BookingStatus.IN_PROGRESS;
        if (ending.Count + starting.Count > 0) await ops.SaveChangesAsync();

        // 4. Equipment status is DERIVED from bookings: RESERVED <=> some booking is IN_PROGRESS (BR-BK-12/14).
        //    MAINTENANCE is never touched here. Deriving it makes the Core/Ops pair self-healing after crashes.
        var inUse = await ops.Bookings.Where(b => b.Status == BookingStatus.IN_PROGRESS).Select(b => b.EquipmentId).Distinct().ToListAsync();
        var candidates = await core.Equipment.Where(e => e.Status != EquipmentStatus.MAINTENANCE).ToListAsync();
        var changed = false;
        foreach (var e in candidates)
        {
            var want = inUse.Contains(e.Id) ? EquipmentStatus.RESERVED : EquipmentStatus.AVAILABLE;
            if (e.Status == want) continue;
            if (e.Status == EquipmentStatus.RESERVED) d.Activity($"{Domain.Eq(e)} is now available for booking.");
            e.Status = want; changed = true;
        }
        if (changed) { await core.SaveChangesAsync(); await ops.SaveChangesAsync(); }

        // 5. Reconcile orphans: bookings/repair requests whose equipment no longer exists in Core
        //    (e.g. the server stopped between deleting the equipment and cleaning Ops).
        var refIds = (await ops.Bookings.Select(b => b.EquipmentId).Distinct().ToListAsync())
            .Union(await ops.RepairRequests.Select(r => r.EquipmentId).Distinct().ToListAsync()).ToList();
        if (refIds.Count > 0)
        {
            var existing = await core.Equipment.Where(e => refIds.Contains(e.Id)).Select(e => e.Id).ToListAsync();
            var orphans = refIds.Except(existing).ToList();
            if (orphans.Count > 0)
            {
                await ops.Bookings.Where(b => orphans.Contains(b.EquipmentId)).ExecuteDeleteAsync();
                await ops.RepairRequests.Where(r => orphans.Contains(r.EquipmentId)).ExecuteDeleteAsync();
                log.LogWarning("Removed Ops records of deleted equipment ids: {Ids}", string.Join(",", orphans));
            }
        }
    }
}

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Lems;

/// <summary>Talks to the Python AI component. Failures never break the main flow.</summary>
public class AiClient(IHttpClientFactory factory, ILogger<AiClient> log)
{
    public async Task<string?> AnalyzeAsync(Equipment e, RepairRequest r)
    {
        try
        {
            var client = factory.CreateClient("ai");
            var payload = new
            {
                problem_title = r.Title,
                problem_description = r.Description,
                equipment = new
                {
                    inventory_number = e.InventoryNumber,
                    title = e.Title,
                    description = e.Description,
                    category = e.Category,
                    location = e.Location
                }
            };
            var resp = await client.PostAsJsonAsync("/analyze", payload);
            resp.EnsureSuccessStatusCode();
            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var recs = root.GetProperty("recommendations").EnumerateArray().Select(x => x.GetString() ?? "").ToList();
            var summary = root.GetProperty("summary").GetString() ?? "";
            return JsonSerializer.Serialize(new { summary, recommendations = recs });
        }
        catch (Exception ex)
        {
            log.LogWarning("AI component unavailable: {Msg}", ex.Message);
            return null;
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

using Microsoft.EntityFrameworkCore;

namespace Lems;

public class LemsOptions
{
    public int OpenHour { get; set; } = 8;
    public int CloseHour { get; set; } = 20;
    public int PendingTimeoutHours { get; set; } = 24;
    public int MaxDaysAhead { get; set; } = 60;
}

/// <summary>
/// Business logic that spans BOTH databases. There are no distributed transactions between Azure SQL (core)
/// and PostgreSQL (ops), so every multi-step operation follows these rules:
///   1. write the database that owns the "truth" first (equipment status lives in Core),
///   2. then update the other database,
///   3. every step is idempotent, so a failed request can simply be repeated,
///   4. LifecycleWorker reconciles anything a crash left behind.
/// Methods only stage changes in 'ops'; callers call ops.SaveChangesAsync(). Core saves happen inside where noted.
/// </summary>
public class Domain(CoreDb core, OpsDb ops)
{
    public static string Eq(Equipment e) => $"Equipment {e.Title} (Inventory No.: {e.InventoryNumber}) at {e.Location}";
    public static string When(Booking b) => $"{b.StartTime:dd.MM.yyyy HH:mm}-{b.EndTime:HH:mm}";

    public void Notify(int userId, string message) =>
        ops.Notifications.Add(new Notification { UserId = userId, Message = message, CreatedAt = DateTime.Now });

    public async Task NotifyAdmins(string message)
    {
        var ids = await core.Users.Where(u => u.Role == Role.ADMIN).Select(u => u.Id).ToListAsync();
        foreach (var id in ids) Notify(id, message);
    }

    public void Activity(string message) =>
        ops.Activity.Add(new ActivityEvent { Message = message, CreatedAt = DateTime.Now });

    /// <summary>BR-MT-02/03/04: cancel all PENDING and CONFIRMED bookings of the equipment (any date).
    /// IN_PROGRESS bookings are not touched (BR-MT-08).</summary>
    public async Task<int> CancelOpenBookings(Equipment e, string reason)
    {
        var list = await ops.Bookings
            .Where(b => b.EquipmentId == e.Id && (b.Status == BookingStatus.PENDING || b.Status == BookingStatus.CONFIRMED))
            .ToListAsync();
        foreach (var b in list)
        {
            b.Status = BookingStatus.CANCELED;
            Notify(b.UserId, $"Your booking of {e.Title} ({When(b)}) has been canceled: {reason}");
        }
        return list.Count;
    }

    /// <summary>Equipment -> MAINTENANCE. Step 1 (Core): status is saved FIRST so new bookings are refused at once.
    /// Step 2 (Ops): open bookings are canceled. Safe to repeat if step 2 failed.</summary>
    public async Task SetMaintenance(Equipment e, string reason)
    {
        var was = e.Status == EquipmentStatus.MAINTENANCE;
        if (!was)
        {
            e.Status = EquipmentStatus.MAINTENANCE;
            await core.SaveChangesAsync();
        }
        await CancelOpenBookings(e, reason);
        if (!was)
            Activity($"{Eq(e)} has been placed under maintenance and is unavailable for booking. All affected reservations have been cancelled.");
    }

    /// <summary>Leave MAINTENANCE (saves Core). RESERVED if a booking is still IN_PROGRESS, otherwise AVAILABLE.</summary>
    public async Task LeaveMaintenance(Equipment e)
    {
        if (e.Status != EquipmentStatus.MAINTENANCE) return;
        var inUse = await ops.Bookings.AnyAsync(b => b.EquipmentId == e.Id && b.Status == BookingStatus.IN_PROGRESS);
        e.Status = inUse ? EquipmentStatus.RESERVED : EquipmentStatus.AVAILABLE;
        await core.SaveChangesAsync();
        if (!inUse) Activity($"{Eq(e)} is now available for booking.");
    }
}

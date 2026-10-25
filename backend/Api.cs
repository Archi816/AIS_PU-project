using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Lems;

public record LoginReq(string? Email, string? Password);
public record RegisterReq(string? Email, string? Password, string? ConfirmPassword);
public record EquipmentReq(string? InventoryNumber, string? Title, string? Description, string? Location, string? Category, string? Status);
public record BookingReq(int EquipmentId, DateTime? Start, string? Description);
public record RepairReq(int EquipmentId, string? Title, string? Description);
public record CompleteReq(bool Working);

/// <summary>HTTP endpoints. 'core' = Azure SQL (users, sessions, equipment); 'ops' = PostgreSQL (bookings, repairs, notifications, activity).</summary>
public static class Api
{
    static readonly SemaphoreSlim BookLock = new(1, 1);
    static readonly Regex StudentEmail = new(@"^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*@student\.tuke\.sk$", RegexOptions.Compiled);

    // ---------- helpers ----------
    static IResult Err(int code, string msg, object? fields = null) => Results.Json(new { error = msg, fields }, statusCode: code);
    static IResult Unauth() => Err(401, "Not authenticated");
    static IResult Forbidden() => Err(403, "You do not have permission to do this");
    static IResult NotFound(string what) => Err(404, $"{what} not found");
    static ILogger Log(HttpContext h) => h.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Lems.Api");

    /// <summary>Saves a context; returns an error result instead of throwing.</summary>
    static async Task<IResult?> TrySave(DbContext db)
    {
        try { await db.SaveChangesAsync(); return null; }
        catch (DbUpdateConcurrencyException) { return Err(409, "The record was changed by someone else. Please refresh and try again."); }
        catch (DbUpdateException) { return Err(500, "Saving failed. Please try again."); }
    }

    static async Task<Dictionary<int, Equipment>> EqMap(CoreDb core, IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToList();
        return await core.Equipment.Where(e => list.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
    }

    static async Task<Dictionary<int, User>> UserMap(CoreDb core, IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToList();
        return await core.Users.Where(u => list.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
    }

    static object UserDto(User u) => new { u.Id, u.Name, u.Surname, u.Email, role = u.Role };

    static object EqDto(Equipment e) => new
    {
        e.Id, inventoryNumber = e.InventoryNumber, e.Title, e.Description, e.Location, e.Category, e.Status, createdAt = e.CreatedAt
    };

    static object BookingDto(Booking b, Equipment? eq, User? u, Me me, DateTime now) => new
    {
        b.Id,
        equipmentId = b.EquipmentId,
        equipmentTitle = eq?.Title,
        inventoryNumber = eq?.InventoryNumber,
        location = eq?.Location,
        userId = b.UserId,
        studentName = u == null ? "" : $"{u.Name} {u.Surname}",
        studentEmail = u?.Email,
        b.Description,
        start = b.StartTime,
        end = b.EndTime,
        b.Status,
        createdAt = b.CreatedAt,
        canCancel = (b.Status == BookingStatus.PENDING || b.Status == BookingStatus.CONFIRMED) && now < b.StartTime
                    && (me.Role == Role.ADMIN || b.UserId == me.Id),
        canDecide = me.Role == Role.ADMIN && b.Status == BookingStatus.PENDING && now < b.StartTime
    };

    static Dictionary<string, string> ValidateEquipment(EquipmentReq r)
    {
        var e = new Dictionary<string, string>();
        var inv = r.InventoryNumber?.Trim() ?? "";
        var title = r.Title?.Trim() ?? "";
        var loc = r.Location?.Trim() ?? "";
        var cat = r.Category?.Trim() ?? "";
        if (inv.Length == 0 || inv.Length > 10) e["inventoryNumber"] = "Required, max 10 characters";
        if (title.Length == 0 || title.Length > 25) e["title"] = "Required, max 25 characters";
        if (loc.Length == 0 || loc.Length > 20) e["location"] = "Required, max 20 characters";
        if (cat.Length == 0 || cat.Length > 30) e["category"] = "Required, max 30 characters";
        if ((r.Description?.Length ?? 0) > 250) e["description"] = "Max 250 characters";
        return e;
    }

    // ---------- routes ----------
    public static void Map(WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", Health);

        api.MapPost("/auth/login", Login);
        api.MapPost("/auth/register", Register);
        api.MapPost("/auth/logout", Logout);
        api.MapGet("/auth/me", Me_);

        api.MapGet("/dashboard", Dashboard);

        api.MapGet("/equipment", ListEquipment);
        api.MapPost("/equipment", CreateEquipment);
        api.MapPut("/equipment/{id:int}", UpdateEquipment);
        api.MapDelete("/equipment/{id:int}", DeleteEquipment);
        api.MapGet("/equipment/{id:int}/slots", Slots);

        api.MapGet("/bookings", ListBookings);
        api.MapPost("/bookings", CreateBooking);
        api.MapPost("/bookings/{id:int}/cancel", CancelBooking);
        api.MapPost("/bookings/{id:int}/approve", ApproveBooking);
        api.MapPost("/bookings/{id:int}/reject", RejectBooking);

        api.MapGet("/repairs", ListRepairs);
        api.MapPost("/repairs", CreateRepair);
        api.MapPost("/repairs/{id:int}/confirm", ConfirmRepair);
        api.MapPost("/repairs/{id:int}/dismiss", DismissRepair);
        api.MapPost("/repairs/{id:int}/complete", CompleteRepair);

        api.MapGet("/notifications", ListNotifications);
        api.MapPost("/notifications/read-all", ReadAll);
    }

    // ---------- health: shows that both databases are reachable ----------
    static async Task<IResult> Health(CoreDb core, OpsDb ops)
    {
        async Task<(bool Up, object Info)> Ping(DbContext c)
        {
            var up = false;
            try { up = await c.Database.CanConnectAsync(); } catch { }
            return (up, new { status = up ? "up" : "down", provider = c.Database.ProviderName });
        }
        var a = await Ping(core); var b = await Ping(ops);
        return Results.Json(new { core = a.Info, ops = b.Info }, statusCode: a.Up && b.Up ? 200 : 503);
    }

    // ---------- auth ----------
    static async Task<IResult> Logout(HttpContext http, CoreDb core)
    {
        await Security.SignOutAsync(http);
        return Results.Ok(new { ok = true });
    }

    static async Task<IResult> Login(LoginReq req, HttpContext http, CoreDb core, LoginThrottle throttle)
    {
        var email = req.Email?.Trim().ToLowerInvariant() ?? "";
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "?";
        var userKey = $"{email}|{ip}";
        if (throttle.IsBlocked(userKey, 8, out var wait) || throttle.IsBlocked(ip, 40, out wait))
        {
            http.Response.Headers["Retry-After"] = wait.ToString();
            return Err(429, $"Too many failed attempts. Please try again in {wait} seconds.");
        }
        var user = await core.Users.FirstOrDefaultAsync(u => u.Email == email);
        var pw = req.Password ?? "";
        bool ok;
        if (user == null) { Security.FakeVerify(pw); ok = false; }
        else ok = pw.Length > 0 && pw.Length <= 128 && Security.Verify(pw, user.PasswordHash);
        if (!ok || user == null)
        {
            throttle.Fail(userKey); throttle.Fail(ip);
            return Err(401, "Invalid email or password");
        }
        throttle.Reset(userKey);
        if (Security.NeedsRehash(user.PasswordHash)) { user.PasswordHash = Security.Hash(pw); await core.SaveChangesAsync(); }
        await Security.SignInAsync(http, user);
        return Results.Ok(UserDto(user));
    }

    static string Cap(string s)
    {
        var t = Regex.Replace(s, @"\d", "");
        if (t.Length == 0) t = s;
        return char.ToUpperInvariant(t[0]) + t[1..];
    }

    static async Task<IResult> Register(RegisterReq req, HttpContext http, CoreDb core)
    {
        var email = req.Email?.Trim().ToLowerInvariant() ?? "";
        var fields = new Dictionary<string, string>();
        if (!StudentEmail.IsMatch(email)) fields["email"] = "Email must look like name.surname@student.tuke.sk";
        var pwProblem = Security.PasswordProblem(req.Password);
        if (pwProblem != null) fields["password"] = pwProblem;
        if (req.Password != req.ConfirmPassword) fields["confirmPassword"] = "Passwords do not match";
        if (fields.Count > 0) return Err(400, "Please correct the highlighted fields", fields);

        if (await core.Users.AnyAsync(u => u.Email == email))
            return Err(409, "Email Already Registered", new { email = "Email Already Registered" });

        var parts = email.Split('@')[0].Split('.');
        var user = new User
        {
            Name = Cap(parts[0]), Surname = Cap(parts[1]), Email = email,
            PasswordHash = Security.Hash(req.Password!), Role = Role.STUDENT, CreatedAt = DateTime.Now
        };
        try
        {
            core.Users.Add(user);
            await core.SaveChangesAsync();
        }
        catch (DbUpdateException) { return Err(409, "Email Already Registered", new { email = "Email Already Registered" }); }
        await Security.SignInAsync(http, user);
        return Results.Ok(UserDto(user));
    }

    static async Task<IResult> Me_(HttpContext http, CoreDb core)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var u = await core.Users.FindAsync(me.Id);
        if (u == null) { await Security.SignOutAsync(http); return Unauth(); }
        return Results.Ok(UserDto(u));
    }

    // ---------- dashboard ----------
    static async Task<IResult> Dashboard(HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var available = await core.Equipment.CountAsync(e => e.Status == EquipmentStatus.AVAILABLE);
        var reserved = await core.Equipment.CountAsync(e => e.Status == EquipmentStatus.RESERVED);
        var maintenance = await core.Equipment.CountAsync(e => e.Status == EquipmentStatus.MAINTENANCE);
        var feed = await ops.Activity.OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(20)
            .Select(a => new { a.Id, a.Message, createdAt = a.CreatedAt }).ToListAsync();

        object? admin = null;
        if (me.Role == Role.ADMIN)
        {
            admin = new
            {
                repairsOpen = await ops.RepairRequests.CountAsync(r => r.Status == RepairStatus.OPEN),
                repairsClosed = await ops.RepairRequests.CountAsync(r => r.Status == RepairStatus.CLOSED),
                students = await core.Users.CountAsync(u => u.Role == Role.STUDENT),
                admins = await core.Users.CountAsync(u => u.Role == Role.ADMIN),
                pendingBookings = await ops.Bookings.CountAsync(b => b.Status == BookingStatus.PENDING)
            };
        }
        return Results.Ok(new { equipment = new { available, reserved, maintenance, total = available + reserved + maintenance }, admin, feed });
    }

    // ---------- equipment (Core) ----------
    static async Task<IResult> ListEquipment(HttpContext http, CoreDb core, string? q, string? category, string? status, string? sort, int? page, int? pageSize)
    {
        if (Security.Current(http) == null) return Unauth();
        var baseQ = core.Equipment.AsQueryable();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim()}%";
            baseQ = baseQ.Where(e => EF.Functions.Like(e.Title, like) || EF.Functions.Like(e.InventoryNumber, like));
        }
        if (!string.IsNullOrWhiteSpace(category)) baseQ = baseQ.Where(e => e.Category == category);

        var grouped = await baseQ.GroupBy(e => e.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync();
        int C(EquipmentStatus s) => grouped.FirstOrDefault(g => g.Status == s)?.Count ?? 0;
        var counts = new { all = grouped.Sum(g => g.Count), available = C(EquipmentStatus.AVAILABLE), reserved = C(EquipmentStatus.RESERVED), maintenance = C(EquipmentStatus.MAINTENANCE) };

        var filtered = baseQ;
        if (Enum.TryParse<EquipmentStatus>(status, true, out var st)) filtered = filtered.Where(e => e.Status == st);
        filtered = sort switch
        {
            "inventory" => filtered.OrderBy(e => e.InventoryNumber),
            "status" => filtered.OrderBy(e => e.Status).ThenBy(e => e.Title),
            "newest" => filtered.OrderByDescending(e => e.CreatedAt),
            _ => filtered.OrderBy(e => e.Title)
        };
        var size = Math.Clamp(pageSize ?? 9, 1, 60);
        var pg = Math.Max(page ?? 1, 1);
        var total = await filtered.CountAsync();
        var items = await filtered.Skip((pg - 1) * size).Take(size).ToListAsync();
        var categories = await core.Equipment.Select(e => e.Category).Distinct().OrderBy(c => c).ToListAsync();
        return Results.Ok(new { items = items.Select(EqDto), total, page = pg, pageSize = size, counts, categories });
    }

    /// <summary>Activity events are best-effort: the main change is already committed in Core.</summary>
    static async Task PublishAsync(HttpContext http, OpsDb ops)
    {
        try { await ops.SaveChangesAsync(); }
        catch (Exception ex) { Log(http).LogError(ex, "Could not write Ops records (activity/notifications)"); }
    }

    static async Task<IResult> CreateEquipment(EquipmentReq req, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var fields = ValidateEquipment(req);
        if (fields.Count > 0) return Err(400, "Please correct the highlighted fields", fields);
        var inv = req.InventoryNumber!.Trim();
        if (await core.Equipment.AnyAsync(e => e.InventoryNumber == inv))
            return Err(409, "Duplicate inventory number", new { inventoryNumber = "Inventory number already exists" });

        var eq = new Equipment
        {
            InventoryNumber = inv, Title = req.Title!.Trim(), Description = req.Description?.Trim() ?? "",
            Location = req.Location!.Trim(), Category = req.Category!.Trim(), Status = EquipmentStatus.AVAILABLE
        };
        core.Equipment.Add(eq);
        var fail = await TrySave(core);
        if (fail != null) return fail;
        new Domain(core, ops).Activity($"New equipment {eq.Title} (Inventory No.: {eq.InventoryNumber}) has been added to the laboratory inventory at {eq.Location}.");
        await PublishAsync(http, ops);   // published only after the save succeeded (BR-EQ-U-03)
        return Results.Ok(EqDto(eq));
    }

    static async Task<IResult> UpdateEquipment(int id, EquipmentReq req, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var eq = await core.Equipment.FindAsync(id);
        if (eq == null) return NotFound("Equipment");
        var fields = ValidateEquipment(req);
        if (fields.Count > 0) return Err(400, "Please correct the highlighted fields", fields);
        var inv = req.InventoryNumber!.Trim();
        if (await core.Equipment.AnyAsync(e => e.InventoryNumber == inv && e.Id != id))
            return Err(409, "Duplicate inventory number", new { inventoryNumber = "Inventory number already exists" });

        var d = new Domain(core, ops);
        var changed = new List<string>();
        void Set(string name, string oldV, string newV, Action<string> apply)
        {
            if (oldV != newV) { apply(newV); changed.Add(name); }
        }
        Set("inventory number", eq.InventoryNumber, inv, v => eq.InventoryNumber = v);
        Set("title", eq.Title, req.Title!.Trim(), v => eq.Title = v);
        Set("description", eq.Description, req.Description?.Trim() ?? "", v => eq.Description = v);
        Set("location", eq.Location, req.Location!.Trim(), v => eq.Location = v);
        Set("category", eq.Category, req.Category!.Trim(), v => eq.Category = v);

        try
        {
            // RESERVED is system-managed; the admin may only switch AVAILABLE <-> MAINTENANCE
            if (Enum.TryParse<EquipmentStatus>(req.Status, true, out var target))
            {
                if (target == EquipmentStatus.MAINTENANCE && eq.Status != EquipmentStatus.MAINTENANCE)
                    await d.SetMaintenance(eq, "the equipment was placed under maintenance");   // saves Core, stages Ops
                else if (target == EquipmentStatus.AVAILABLE && eq.Status == EquipmentStatus.MAINTENANCE)
                    await d.LeaveMaintenance(eq);                                               // saves Core
            }
            await core.SaveChangesAsync();   // detail changes (no-op if already saved above)
        }
        catch (DbUpdateException) { return Err(500, "Equipment could not be updated"); }

        if (changed.Count > 0)
            d.Activity($"The following details of equipment {eq.Title} (Inventory No.: {eq.InventoryNumber}) have been updated: {string.Join(", ", changed)} at {eq.Location}.");
        // Ops: cancellations, notifications, events. If this fails the admin can repeat the action (idempotent).
        var fail = await TrySave(ops);
        if (fail != null) return fail;
        return Results.Ok(EqDto(eq));
    }

    static async Task<IResult> DeleteEquipment(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var eq = await core.Equipment.FindAsync(id);
        if (eq == null) return NotFound("Equipment");
        var d = new Domain(core, ops);

        // BR-EQ-D-02: no blocking checks. Students with live bookings are only informed.
        var live = await ops.Bookings.Where(b => b.EquipmentId == id &&
            (b.Status == BookingStatus.PENDING || b.Status == BookingStatus.CONFIRMED || b.Status == BookingStatus.IN_PROGRESS)).ToListAsync();

        // Step 1 (Core): the delete itself - the point of no return.
        core.Equipment.Remove(eq);
        var fail = await TrySave(core);
        if (fail != null) return fail;

        // Step 2 (Ops): no cross-database cascade exists, so the application cleans up. If this fails,
        // LifecycleWorker removes the orphaned bookings/requests within seconds.
        string? warning = null;
        try
        {
            foreach (var b in live)
                d.Notify(b.UserId, $"Your booking of {eq.Title} ({Domain.When(b)}) was canceled because the equipment was removed from the inventory.");
            d.Activity($"Equipment {eq.Title} (Inventory No.: {eq.InventoryNumber}) has been removed from the laboratory inventory at {eq.Location}.");
            await ops.SaveChangesAsync();
            await ops.Bookings.Where(b => b.EquipmentId == id).ExecuteDeleteAsync();
            await ops.RepairRequests.Where(r => r.EquipmentId == id).ExecuteDeleteAsync();
        }
        catch (Exception ex)
        {
            Log(http).LogError(ex, "Ops cleanup after equipment delete failed; reconciliation worker will finish it");
            warning = "Equipment deleted; related records will be cleaned up shortly.";
        }
        return Results.Ok(new { ok = true, warning });
    }

    static async Task<IResult> Slots(int id, string? date, HttpContext http, CoreDb core, OpsDb ops, IOptions<LemsOptions> opt)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var eq = await core.Equipment.FindAsync(id);
        if (eq == null) return NotFound("Equipment");
        if (!DateOnly.TryParse(date, out var day)) return Err(400, "Invalid date");
        var from = day.ToDateTime(TimeOnly.MinValue);
        var to = from.AddDays(1);
        var busy = await ops.Bookings.Where(b => b.EquipmentId == id && b.StartTime >= from && b.StartTime < to &&
            (b.Status == BookingStatus.PENDING || b.Status == BookingStatus.CONFIRMED || b.Status == BookingStatus.IN_PROGRESS))
            .Select(b => new { b.StartTime, b.UserId }).ToListAsync();
        var now = DateTime.Now;
        var slots = new List<object>();
        for (var h = opt.Value.OpenHour; h < opt.Value.CloseHour; h++)
        {
            var s = from.AddHours(h);
            var taken = busy.FirstOrDefault(b => b.StartTime == s);
            var state = eq.Status == EquipmentStatus.MAINTENANCE ? "maintenance"
                : s <= now ? "past"
                : taken != null ? (taken.UserId == me.Id ? "mine" : "taken")
                : "free";
            slots.Add(new { start = s, end = s.AddHours(1), state });
        }
        return Results.Ok(new { equipment = EqDto(eq), slots });
    }

    // ---------- bookings (Ops, joined with Core in code) ----------
    static async Task<IResult> ListBookings(HttpContext http, CoreDb core, OpsDb ops, string? status)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var q = ops.Bookings.AsQueryable();
        if (me.Role == Role.STUDENT) q = q.Where(b => b.UserId == me.Id);
        if (Enum.TryParse<BookingStatus>(status, true, out var st)) q = q.Where(b => b.Status == st);
        var list = await q.OrderByDescending(b => b.StartTime).ToListAsync();
        var eqs = await EqMap(core, list.Select(b => b.EquipmentId));
        var users = me.Role == Role.ADMIN ? await UserMap(core, list.Select(b => b.UserId)) : new Dictionary<int, User>();
        var now = DateTime.Now;
        return Results.Ok(list.Select(b => BookingDto(b, eqs.GetValueOrDefault(b.EquipmentId), users.GetValueOrDefault(b.UserId), me, now)));
    }

    static async Task<IResult> CreateBooking(BookingReq req, HttpContext http, CoreDb core, OpsDb ops, IOptions<LemsOptions> opt)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.STUDENT) return Forbidden();
        var o = opt.Value;
        var now = DateTime.Now;
        var fields = new Dictionary<string, string>();
        if (req.Start is not DateTime start) fields["start"] = "Select a time slot";
        else
        {
            if (start.Minute != 0 || start.Second != 0 || start.Hour < o.OpenHour || start.Hour >= o.CloseHour)
                fields["start"] = $"Slots are one hour long, between {o.OpenHour}:00 and {o.CloseHour}:00";
            else if (start <= now) fields["start"] = "The slot is in the past";
            else if (start > now.AddDays(o.MaxDaysAhead)) fields["start"] = $"You can book at most {o.MaxDaysAhead} days ahead";
        }
        var desc = req.Description?.Trim() ?? "";
        if (desc.Length == 0 || desc.Length > 500) fields["description"] = "Describe the purpose (max 500 characters)";
        if (fields.Count > 0) return Err(400, "Please correct the highlighted fields", fields);

        var s = req.Start!.Value;
        var e = s.AddHours(1);
        await BookLock.WaitAsync();   // fast path against double booking; the unique index is the real guarantee
        try
        {
            var eq = await core.Equipment.FindAsync(req.EquipmentId);                       // Core: exists / not in maintenance
            if (eq == null) return NotFound("Equipment");
            if (eq.Status == EquipmentStatus.MAINTENANCE) return Err(409, "Equipment unavailable (under maintenance)");
            var taken = await ops.Bookings.AnyAsync(b => b.EquipmentId == eq.Id && b.StartTime < e && b.EndTime > s &&
                (b.Status == BookingStatus.PENDING || b.Status == BookingStatus.CONFIRMED || b.Status == BookingStatus.IN_PROGRESS));
            if (taken) return Err(409, "Slot unavailable");

            var user = await core.Users.FindAsync(me.Id);
            var booking = new Booking { UserId = me.Id, EquipmentId = eq.Id, Description = desc, StartTime = s, EndTime = e, Status = BookingStatus.PENDING, CreatedAt = now };
            ops.Bookings.Add(booking);   // slot is blocked immediately (BR-BK-05)
            await new Domain(core, ops).NotifyAdmins($"New booking request: {user?.Name} {user?.Surname} requested {eq.Title} for {Domain.When(booking)}.");
            try { await ops.SaveChangesAsync(); }
            catch (DbUpdateException) { return Err(409, "Slot unavailable"); }   // unique index: another instance won

            // Compensation: the equipment may have entered MAINTENANCE between the check and the insert
            // (two databases = no shared transaction). Re-read the status and undo if needed.
            var st = await core.Equipment.AsNoTracking().Where(x => x.Id == eq.Id).Select(x => (EquipmentStatus?)x.Status).FirstOrDefaultAsync();
            if (st == null || st == EquipmentStatus.MAINTENANCE)
            {
                booking.Status = BookingStatus.CANCELED;
                await ops.SaveChangesAsync();
                return Err(409, "Equipment unavailable (under maintenance)");
            }
            return Results.Ok(BookingDto(booking, eq, user, me, now));
        }
        finally { BookLock.Release(); }
    }

    static async Task<IResult> CancelBooking(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var b = await ops.Bookings.FindAsync(id);
        if (b == null || (me.Role == Role.STUDENT && b.UserId != me.Id)) return NotFound("Booking");
        if ((b.Status != BookingStatus.PENDING && b.Status != BookingStatus.CONFIRMED) || DateTime.Now >= b.StartTime)
            return Err(409, "Cancellation unavailable");
        var eq = await core.Equipment.FindAsync(b.EquipmentId);
        b.Status = BookingStatus.CANCELED;      // releases the slot
        new Domain(core, ops).Notify(b.UserId, me.Role == Role.ADMIN && b.UserId != me.Id
            ? $"Your booking of {eq?.Title} ({Domain.When(b)}) was canceled by an administrator."
            : $"Your booking of {eq?.Title} ({Domain.When(b)}) has been canceled.");
        var fail = await TrySave(ops);
        if (fail != null) return fail;
        return Results.Ok(BookingDto(b, eq, null, me, DateTime.Now));
    }

    static async Task<IResult> ApproveBooking(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var b = await ops.Bookings.FindAsync(id);
        if (b == null) return NotFound("Booking");
        var now = DateTime.Now;
        if (b.Status != BookingStatus.PENDING || b.StartTime <= now)
            return Err(409, "Only a PENDING request whose start time has not yet arrived can be approved");
        var eq = await core.Equipment.FindAsync(b.EquipmentId);
        var d = new Domain(core, ops);
        if (eq == null || eq.Status == EquipmentStatus.MAINTENANCE)
        {
            b.Status = BookingStatus.CANCELED;
            d.Notify(b.UserId, $"Your booking of {eq?.Title ?? "the equipment"} ({Domain.When(b)}) was canceled because the equipment is unavailable.");
            await TrySave(ops);
            return Err(409, "Equipment is under maintenance - the booking was canceled");
        }
        b.Status = BookingStatus.CONFIRMED;     // Status is a concurrency token: loses against a parallel cancellation
        d.Notify(b.UserId, $"Your booking of {eq.Title} ({Domain.When(b)}) has been confirmed.");
        d.Activity($"{Domain.Eq(eq)} is now reserved from {b.StartTime:HH:mm} to {b.EndTime:HH:mm} on {b.StartTime:dd.MM.yyyy}.");
        var fail = await TrySave(ops);
        if (fail != null) return fail;
        var u = await core.Users.FindAsync(b.UserId);
        return Results.Ok(BookingDto(b, eq, u, me, now));
    }

    static async Task<IResult> RejectBooking(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var b = await ops.Bookings.FindAsync(id);
        if (b == null) return NotFound("Booking");
        if (b.Status != BookingStatus.PENDING) return Err(409, "Only PENDING requests can be rejected");
        var eq = await core.Equipment.FindAsync(b.EquipmentId);
        b.Status = BookingStatus.REJECTED;      // releases the slot
        new Domain(core, ops).Notify(b.UserId, $"Your booking of {eq?.Title} ({Domain.When(b)}) has been rejected.");
        var fail = await TrySave(ops);
        if (fail != null) return fail;
        return Results.Ok(BookingDto(b, eq, null, me, DateTime.Now));
    }

    // ---------- repair requests ----------
    static object RepairDto(RepairRequest r, Equipment? eq, User? reporter, Me me)
    {
        object? ai = null;
        if (me.Role == Role.ADMIN && !string.IsNullOrEmpty(r.AiRecommendations))
        {
            try { ai = JsonSerializer.Deserialize<JsonElement>(r.AiRecommendations); } catch { }
        }
        var stage = r.Status == RepairStatus.CLOSED ? (r.Resolution ?? "RESOLVED") : r.Confirmed ? "IN_REPAIR" : "AWAITING_REVIEW";
        return new
        {
            r.Id, r.Title, r.Description, r.Status, r.Confirmed, r.Resolution, stage,
            createdAt = r.CreatedAt,
            equipmentId = r.EquipmentId,
            equipmentTitle = eq?.Title,
            inventoryNumber = eq?.InventoryNumber,
            location = eq?.Location,
            equipmentStatus = eq?.Status,
            reporter = reporter == null ? "" : $"{reporter.Name} {reporter.Surname}",
            ai
        };
    }

    static async Task<IResult> ListRepairs(HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var q = ops.RepairRequests.AsQueryable();
        if (me.Role == Role.STUDENT) q = q.Where(r => r.CreatedBy == me.Id);
        var list = await q.OrderBy(r => r.Status).ThenByDescending(r => r.CreatedAt).ToListAsync();
        var eqs = await EqMap(core, list.Select(r => r.EquipmentId));
        var users = await UserMap(core, list.Select(r => r.CreatedBy));
        return Results.Ok(list.Select(r => RepairDto(r, eqs.GetValueOrDefault(r.EquipmentId), users.GetValueOrDefault(r.CreatedBy), me)));
    }

    static async Task<IResult> CreateRepair(RepairReq req, HttpContext http, CoreDb core, OpsDb ops, IServiceScopeFactory scopes)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.STUDENT) return Forbidden();
        var fields = new Dictionary<string, string>();
        var title = req.Title?.Trim() ?? "";
        var desc = req.Description?.Trim() ?? "";
        if (title.Length == 0 || title.Length > 50) fields["title"] = "Required, max 50 characters";
        if (desc.Length == 0 || desc.Length > 500) fields["description"] = "A description of the problem is required (max 500 characters)";
        if (fields.Count > 0) return Err(400, "Please correct the highlighted fields", fields);
        var eq = await core.Equipment.FindAsync(req.EquipmentId);
        if (eq == null) return NotFound("Equipment");
        var user = await core.Users.FindAsync(me.Id);

        var rr = new RepairRequest { CreatedBy = me.Id, EquipmentId = eq.Id, Title = title, Description = desc, Status = RepairStatus.OPEN, CreatedAt = DateTime.Now };
        ops.RepairRequests.Add(rr);
        await new Domain(core, ops).NotifyAdmins($"New problem report for {eq.Title} ({eq.InventoryNumber}) by {user?.Name} {user?.Surname}: {title}");
        var fail = await TrySave(ops);
        if (fail != null) return fail;

        var rid = rr.Id;   // AI analysis runs in the background - it must not delay the student
        _ = Task.Run(async () =>
        {
            using var scope = scopes.CreateScope();
            var core2 = scope.ServiceProvider.GetRequiredService<CoreDb>();
            var ops2 = scope.ServiceProvider.GetRequiredService<OpsDb>();
            var ai = scope.ServiceProvider.GetRequiredService<AiClient>();
            var r2 = await ops2.RepairRequests.FirstOrDefaultAsync(r => r.Id == rid);
            var e2 = await core2.Equipment.FindAsync(req.EquipmentId);
            if (r2 == null || e2 == null) return;
            var json = await ai.AnalyzeAsync(e2, r2);
            if (json != null) { r2.AiRecommendations = json; await ops2.SaveChangesAsync(); }
        });
        return Results.Ok(new { id = rr.Id });
    }

    // Problem confirmed -> MAINTENANCE + cancel affected bookings (BR-RP-05). Safe to repeat.
    static async Task<IResult> ConfirmRepair(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var r = await ops.RepairRequests.FindAsync(id);
        if (r == null) return NotFound("Repair request");
        if (r.Status != RepairStatus.OPEN || r.Confirmed) return Err(409, "The request is not awaiting review");
        var eq = await core.Equipment.FindAsync(r.EquipmentId);
        if (eq == null) return NotFound("Equipment");
        var d = new Domain(core, ops);
        try
        {
            await d.SetMaintenance(eq, "the equipment needs repair");   // Core first, then Ops cancellations
            r.Confirmed = true;
            d.Notify(r.CreatedBy, $"Your problem report \"{r.Title}\" was confirmed. {eq.Title} is under repair.");
            await ops.SaveChangesAsync();
        }
        catch (DbUpdateException) { return Err(500, "Saving failed - please press the button again (the action is safe to repeat)."); }
        return Results.Ok(RepairDto(r, eq, null, me));
    }

    // Problem not confirmed -> close, equipment unchanged (BR-RP-04)
    static async Task<IResult> DismissRepair(int id, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var r = await ops.RepairRequests.FindAsync(id);
        if (r == null) return NotFound("Repair request");
        if (r.Status != RepairStatus.OPEN || r.Confirmed) return Err(409, "The request is not awaiting review");
        r.Status = RepairStatus.CLOSED;
        r.Resolution = "NO_REPAIR_REQUIRED";
        new Domain(core, ops).Notify(r.CreatedBy, $"Your problem report \"{r.Title}\" was reviewed: no repair is required.");
        var fail = await TrySave(ops);
        if (fail != null) return fail;
        return Results.Ok(RepairDto(r, await core.Equipment.FindAsync(r.EquipmentId), null, me));
    }

    // Result of repair inspected (BR-RP-07/08). Order: equipment back to service (Core) first, then close (Ops).
    static async Task<IResult> CompleteRepair(int id, CompleteReq req, HttpContext http, CoreDb core, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        if (me.Role != Role.ADMIN) return Forbidden();
        var r = await ops.RepairRequests.FindAsync(id);
        if (r == null) return NotFound("Repair request");
        if (r.Status != RepairStatus.OPEN || !r.Confirmed) return Err(409, "The request is not in repair");
        var eq = await core.Equipment.FindAsync(r.EquipmentId);
        if (!req.Working) return Results.Ok(new { repeated = true, request = RepairDto(r, eq, null, me) });   // repair cycle repeats

        var d = new Domain(core, ops);
        try
        {
            // equipment returns to service only when no other confirmed repair is still open
            var stillBroken = await ops.RepairRequests.AnyAsync(x => x.EquipmentId == r.EquipmentId && x.Id != r.Id && x.Status == RepairStatus.OPEN && x.Confirmed);
            if (eq != null && !stillBroken) await d.LeaveMaintenance(eq);      // Core
            r.Status = RepairStatus.CLOSED;
            r.Resolution = "RESOLVED";
            d.Notify(r.CreatedBy, $"The repair for your report \"{r.Title}\" has been completed.");
            await ops.SaveChangesAsync();                                      // Ops
        }
        catch (DbUpdateException) { return Err(500, "Saving failed - please press the button again (the action is safe to repeat)."); }
        return Results.Ok(new { repeated = false, request = RepairDto(r, eq, null, me) });
    }

    // ---------- notifications (Ops) ----------
    static async Task<IResult> ListNotifications(HttpContext http, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        var items = await ops.Notifications.Where(n => n.UserId == me.Id).OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id)
            .Take(30).Select(n => new { n.Id, n.Message, isRead = n.IsRead, createdAt = n.CreatedAt }).ToListAsync();
        var unread = await ops.Notifications.CountAsync(n => n.UserId == me.Id && !n.IsRead);
        return Results.Ok(new { unread, items });
    }

    static async Task<IResult> ReadAll(HttpContext http, OpsDb ops)
    {
        var me = Security.Current(http);
        if (me == null) return Unauth();
        await ops.Notifications.Where(n => n.UserId == me.Id && !n.IsRead).ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
        return Results.Ok(new { ok = true });
    }
}

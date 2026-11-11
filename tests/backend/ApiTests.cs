using Xunit;
using Microsoft.AspNetCore.Hosting;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Lems.Tests;

/// <summary>
/// Runs the whole backend in-process. By default both DBs are temp SQLite files.
/// To run against the REAL cloud databases (integration test) set before `dotnet test`:
///   LEMS_TEST_CORE_PROVIDER=SqlServer  LEMS_TEST_CORE_CONN="..."
///   LEMS_TEST_OPS_PROVIDER=Postgres    LEMS_TEST_OPS_CONN="..."
/// (use EMPTY test databases - the tests create data and the schema).
/// </summary>
public class LemsFactory : WebApplicationFactory<Program>
{
    static string Env(string k, string d) => Environment.GetEnvironmentVariable(k) ?? d;
    public LemsFactory()
    {
        var dir = Path.Combine(Path.GetTempPath(), "lems-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        Environment.SetEnvironmentVariable("Databases__Core__Provider", Env("LEMS_TEST_CORE_PROVIDER", "Sqlite"));
        Environment.SetEnvironmentVariable("Databases__Core__ConnectionString", Env("LEMS_TEST_CORE_CONN", $"Data Source={Path.Combine(dir, "core.db")}"));
        Environment.SetEnvironmentVariable("Databases__Ops__Provider", Env("LEMS_TEST_OPS_PROVIDER", "Sqlite"));
        Environment.SetEnvironmentVariable("Databases__Ops__ConnectionString", Env("LEMS_TEST_OPS_CONN", $"Data Source={Path.Combine(dir, "ops.db")}"));
        Environment.SetEnvironmentVariable("AiService__BaseUrl", "http://127.0.0.1:1"); // AI down on purpose
    }
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder b) => b.UseEnvironment("Development");

    public HttpClient NewClient()
    {
        var c = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Add("X-Requested-With", "LEMS");
        c.DefaultRequestHeaders.Add("Origin", "http://localhost");
        return c;
    }
    public async Task<HttpClient> LoginAs(string email, string pw)
    {
        var c = NewClient();
        var r = await c.PostAsJsonAsync("/api/auth/login", new { email, password = pw });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return c;
    }
    public Task<HttpClient> Admin() => LoginAs("admin@lems.local", "Admin123!");
    public Task<HttpClient> Student() => LoginAs("jan.novak@student.tuke.sk", "Student123!");
}

public class ApiTests : IClassFixture<LemsFactory>
{
    readonly LemsFactory f;
    public ApiTests(LemsFactory f) => this.f = f;

    static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    static int _n;
    static string Inv() => "T" + Interlocked.Increment(ref _n) + Random.Shared.Next(100, 999);

    async Task<int> NewEquipment(HttpClient admin)
    {
        var r = await admin.PostAsJsonAsync("/api/equipment", new { inventoryNumber = Inv(), title = "Test device", description = "d", location = "Lab 1", category = "Testing" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await Json(r)).GetProperty("id").GetInt32();
    }
    static object Book(int eq, DateTime start) => new { equipmentId = eq, start, description = "Experiment" };
    static DateTime Slot(int daysAhead, int hour) => DateTime.Today.AddDays(daysAhead).AddHours(hour);

    // ---------- both databases + auth ----------
    [Fact] public async Task Health_both_databases_up()
    {
        var r = await f.NewClient().GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }
    [Fact] public async Task Login_wrong_password_is_401()
    {
        var r = await f.NewClient().PostAsJsonAsync("/api/auth/login", new { email = "admin@lems.local", password = "nope-nope1" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }
    [Fact] public async Task Me_requires_session_and_works_after_login()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.NewClient().GetAsync("/api/auth/me")).StatusCode);
        var c = await f.Student();
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact] public async Task Logout_revokes_session()
    {
        var c = await f.Student();
        await c.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact] public async Task Csrf_header_is_required_for_post()
    {
        var c = f.CreateClient(); // no X-Requested-With / Origin
        var r = await c.PostAsJsonAsync("/api/auth/login", new { email = "admin@lems.local", password = "Admin123!" });
        Assert.NotEqual(HttpStatusCode.OK, r.StatusCode);
    }
    [Fact] public async Task Register_valid_student_and_reject_bad_email()
    {
        var c = f.NewClient();
        var email = "anna.kovac@student.tuke.sk";
        var ok = await c.PostAsJsonAsync("/api/auth/register", new { email, password = "Passw0rd!x", confirmPassword = "Passw0rd!x" });
        Assert.True(ok.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict);
        var bad = await f.NewClient().PostAsJsonAsync("/api/auth/register", new { email = "x@gmail.com", password = "Passw0rd!x", confirmPassword = "Passw0rd!x" });
        Assert.True((int)bad.StatusCode is >= 400 and < 500);
    }

    // ---------- roles ----------
    [Fact] public async Task Student_cannot_create_equipment()
    {
        var c = await f.Student();
        var r = await c.PostAsJsonAsync("/api/equipment", new { inventoryNumber = Inv(), title = "x", location = "l", category = "c" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }
    [Fact] public async Task Admin_cannot_book()
    {
        var a = await f.Admin(); var id = await NewEquipment(a);
        Assert.Equal(HttpStatusCode.Forbidden, (await a.PostAsJsonAsync("/api/bookings", Book(id, Slot(3, 10)))).StatusCode);
    }
    [Fact] public async Task Equipment_validation_and_duplicate_inventory_number()
    {
        var a = await f.Admin();
        var bad = await a.PostAsJsonAsync("/api/equipment", new { inventoryNumber = "WAY-TOO-LONG-NUMBER", title = "x", location = "l", category = "c" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var inv = Inv();
        var body = new { inventoryNumber = inv, title = "Dup", location = "l", category = "c" };
        Assert.Equal(HttpStatusCode.OK, (await a.PostAsJsonAsync("/api/equipment", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/equipment", body)).StatusCode);
    }

    // ---------- bookings (Ops DB + Core DB together) ----------
    [Fact] public async Task Booking_happy_path_pending_then_approved()
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        var r = await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(3, 10)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var b = await Json(r);
        Assert.Equal("PENDING", b.GetProperty("status").GetString());
        var id = b.GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await a.PostAsync($"/api/bookings/{id}/approve", null)).StatusCode);
    }
    [Fact] public async Task Double_booking_same_slot_is_409()
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        Assert.Equal(HttpStatusCode.OK, (await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(4, 11)))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(4, 11)))).StatusCode);
    }
    [Fact] public async Task Concurrent_booking_only_one_wins()
    {
        var a = await f.Admin(); var eq = await NewEquipment(a);
        var s = await f.Student();
        var rs = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(5, 12)))));
        Assert.Equal(1, rs.Count(r => r.StatusCode == HttpStatusCode.OK));
    }
    [Theory]
    [InlineData(-1, 10)]  // past
    [InlineData(3, 7)]    // before opening
    [InlineData(3, 20)]   // after closing
    [InlineData(400, 10)] // too far ahead
    public async Task Booking_invalid_slot_is_400(int days, int hour)
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(days, hour)))).StatusCode);
    }
    [Fact] public async Task Student_cannot_cancel_foreign_booking_but_can_cancel_own()
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        var id = (await Json(await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(6, 9))))).GetProperty("id").GetInt32();
        var other = f.NewClient();
        await other.PostAsJsonAsync("/api/auth/register", new { email = "petr.horak@student.tuke.sk", password = "Passw0rd!x", confirmPassword = "Passw0rd!x" });
        await other.PostAsJsonAsync("/api/auth/login", new { email = "petr.horak@student.tuke.sk", password = "Passw0rd!x" });
        Assert.NotEqual(HttpStatusCode.OK, (await other.PostAsync($"/api/bookings/{id}/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await s.PostAsync($"/api/bookings/{id}/cancel", null)).StatusCode);
    }

    // ---------- maintenance cascade across the two DBs (BR-MT-02..08) ----------
    [Fact] public async Task Maintenance_cancels_pending_bookings_and_blocks_new_ones()
    {
        var a = await f.Admin(); var s = await f.Student();
        var inv = Inv();
        var eq = (await Json(await a.PostAsJsonAsync("/api/equipment", new { inventoryNumber = inv, title = "Test device", description = "d", location = "Lab 1", category = "Testing" }))).GetProperty("id").GetInt32();
        var bid = (await Json(await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(7, 14))))).GetProperty("id").GetInt32();
        var put = await a.PutAsJsonAsync($"/api/equipment/{eq}", new { inventoryNumber = inv, title = "Test device", description = "d", location = "Lab 1", category = "Testing", status = "MAINTENANCE" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var list = await Json(await s.GetAsync("/api/bookings"));
        var items = list.ValueKind == JsonValueKind.Array ? list.EnumerateArray() : list.GetProperty("items").EnumerateArray();
        Assert.Equal("CANCELED", items.First(x => x.GetProperty("id").GetInt32() == bid).GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(8, 10)))).StatusCode);
    }

    // ---------- repairs + AI component down ----------
    [Fact] public async Task Repair_is_created_even_when_AI_service_is_down()
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        var r = await s.PostAsJsonAsync("/api/repairs", new { equipmentId = eq, title = "Does not start", description = "No power LED after plug-in" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var id = (await Json(r)).GetProperty("id").GetInt32();
        Assert.True(id > 0);
        var list = await Json(await a.GetAsync("/api/repairs"));
        var items = list.ValueKind == JsonValueKind.Array ? list.EnumerateArray() : list.GetProperty("items").EnumerateArray();
        Assert.Equal("OPEN", items.First(x => x.GetProperty("id").GetInt32() == id).GetProperty("status").GetString());
    }
    [Fact] public async Task Repair_without_description_is_400()
    {
        var a = await f.Admin(); var s = await f.Student(); var eq = await NewEquipment(a);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.PostAsJsonAsync("/api/repairs", new { equipmentId = eq, title = "x", description = "" })).StatusCode);
    }
    [Fact] public async Task Dashboard_and_notifications_load()
    {
        var s = await f.Student();
        Assert.Equal(HttpStatusCode.OK, (await s.GetAsync("/api/dashboard")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await s.GetAsync("/api/notifications")).StatusCode);
    }

    // ---------- dashboard schedule + students list ----------
    [Fact] public async Task Schedule_requires_login()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.NewClient().GetAsync("/api/schedule")).StatusCode);
    }
    [Fact] public async Task Schedule_shows_taken_mine_and_maintenance_slots()
    {
        var a = await f.Admin(); var s = await f.Student(); var other = await f.LoginAs("admin@lems.local", "Admin123!");
        var eq = await NewEquipment(a);
        var day = DateTime.Today.AddDays(4);
        Assert.Equal(HttpStatusCode.OK, (await s.PostAsJsonAsync("/api/bookings", Book(eq, Slot(4, 10)))).StatusCode);
        var date = day.ToString("yyyy-MM-dd");

        string State(JsonElement sched, int id, int hour)
        {
            var row = sched.GetProperty("equipment").EnumerateArray().First(e => e.GetProperty("id").GetInt32() == id);
            return row.GetProperty("slots").EnumerateArray().First(x => x.GetProperty("hour").GetInt32() == hour).GetProperty("state").GetString()!;
        }
        var mine = await Json(await s.GetAsync("/api/schedule?date=" + date));
        Assert.Equal("mine", State(mine, eq, 10));
        Assert.Equal("free", State(mine, eq, 11));
        var theirs = await Json(await other.GetAsync("/api/schedule?date=" + date));
        Assert.Equal("taken", State(theirs, eq, 10));

        var put = await a.PutAsJsonAsync($"/api/equipment/{eq}", new { inventoryNumber = Inv(), title = "Test device", description = "d", location = "Lab 1", category = "Testing", status = "MAINTENANCE" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var maint = await Json(await s.GetAsync("/api/schedule?date=" + date));
        Assert.Equal("maintenance", State(maint, eq, 12));
    }
    [Fact] public async Task Schedule_rejects_invalid_date()
    {
        var s = await f.Student();
        Assert.Equal(HttpStatusCode.BadRequest, (await s.GetAsync("/api/schedule?date=not-a-date")).StatusCode);
    }
    [Fact] public async Task Students_list_is_admin_only()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.NewClient().GetAsync("/api/students")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await f.Student()).GetAsync("/api/students")).StatusCode);
        var list = await Json(await (await f.Admin()).GetAsync("/api/students"));
        Assert.True(list.GetArrayLength() >= 1);
        var first = list.EnumerateArray().First();
        foreach (var k in new[] { "name", "surname", "email", "bookings", "activeBookings", "repairs" }) Assert.True(first.TryGetProperty(k, out _), k);
    }

    // ---------- equipment info, profile, reports, notifications, calendar file ----------
    [Fact] public async Task Equipment_info_fields_are_saved_and_validated()
    {
        var a = await f.Admin();
        var bad = await a.PostAsJsonAsync("/api/equipment", new { inventoryNumber = Inv(), title = "Scope", description = "d", location = "Lab 1", category = "Testing", contactEmail = "not-an-email" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("contactEmail", await bad.Content.ReadAsStringAsync());
        var ok = await a.PostAsJsonAsync("/api/equipment", new { inventoryNumber = Inv(), title = "Scope", description = "d", location = "Lab 1", category = "Testing",
            specifications = "Bandwidth 100 MHz", contactName = "Dr. Novak", contactEmail = "novak@tuke.sk" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var created = await Json(ok);
        Assert.Equal("Bandwidth 100 MHz", created.GetProperty("specifications").GetString());
        Assert.Equal("Dr. Novak", created.GetProperty("contactName").GetString());
        Assert.Equal("novak@tuke.sk", created.GetProperty("contactEmail").GetString());
    }
    [Fact] public async Task Profile_can_be_updated_and_email_notifications_switched_off()
    {
        var s = await f.Student();
        var r = await s.PutAsJsonAsync("/api/profile", new { name = "Jana", surname = "Kovacova", emailNotifications = false });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var me = await Json(await s.GetAsync("/api/auth/me"));
        Assert.Equal("Jana", me.GetProperty("name").GetString());
        Assert.False(me.GetProperty("emailNotifications").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await s.PutAsJsonAsync("/api/profile", new { name = "<b>x</b>", surname = "K" })).StatusCode);
        await s.PutAsJsonAsync("/api/profile", new { name = "Jan", surname = "Novak", emailNotifications = true });   // restore for other tests
    }
    [Fact] public async Task Password_change_checks_the_current_password()
    {
        var s = await f.Student();
        var wrong = await s.PostAsJsonAsync("/api/profile/password", new { currentPassword = "nope-nope1", newPassword = "Another123!", confirmPassword = "Another123!" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Contains("currentPassword", await wrong.Content.ReadAsStringAsync());
        var weak = await s.PostAsJsonAsync("/api/profile/password", new { currentPassword = "Student123!", newPassword = "short", confirmPassword = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        var mismatch = await s.PostAsJsonAsync("/api/profile/password", new { currentPassword = "Student123!", newPassword = "Another123!", confirmPassword = "Different123!" });
        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
    }
    [Fact] public async Task Reports_are_admin_only_and_have_the_expected_shape()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await (await f.Student()).GetAsync("/api/reports")).StatusCode);
        var r = await Json(await (await f.Admin()).GetAsync("/api/reports?days=14"));
        Assert.Equal(14, r.GetProperty("days").GetInt32());
        Assert.Equal(14, r.GetProperty("perDay").GetArrayLength());
        foreach (var k in new[] { "totals", "byStatus", "utilization", "faults" }) Assert.True(r.TryGetProperty(k, out _), k);
        Assert.True(r.GetProperty("totals").TryGetProperty("utilizationPercent", out _));
    }
    [Fact] public async Task Notifications_support_paging()
    {
        var s = await f.Student();
        var r = await Json(await s.GetAsync("/api/notifications?page=1&pageSize=5"));
        Assert.Equal(5, r.GetProperty("pageSize").GetInt32());
        Assert.True(r.GetProperty("total").GetInt32() >= r.GetProperty("items").GetArrayLength());
    }
    [Fact] public void Ics_event_is_valid_and_cancel_uses_the_same_uid()
    {
        var b = new Booking { Id = 42, Description = "Lab, part 1; \"test\"", StartTime = new DateTime(2030, 5, 6, 9, 0, 0), EndTime = new DateTime(2030, 5, 6, 10, 0, 0) };
        var publish = Ics.Event(b, "Oscilloscope", "Lab 1", "PUBLISH");
        var cancel = Ics.Event(b, "Oscilloscope", "Lab 1", "CANCEL");
        Assert.Contains("UID:booking-42@lems", publish);
        Assert.Contains("UID:booking-42@lems", cancel);
        Assert.Contains("METHOD:PUBLISH", publish); Assert.Contains("METHOD:CANCEL", cancel);
        Assert.Contains("STATUS:CANCELLED", cancel); Assert.Contains("SEQUENCE:1", cancel);
        Assert.Contains("DTSTART:20300506T090000", publish); Assert.Contains("DTEND:20300506T100000", publish);
        Assert.Contains("Lab\\, part 1\\; ", publish);   // commas and semicolons are escaped
        Assert.All(publish.Split("\r\n"), line => Assert.True(line.Length <= 75, line));
        Assert.EndsWith("END:VCALENDAR\r\n", publish);
    }
}

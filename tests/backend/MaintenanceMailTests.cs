using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Lems.Tests;

/// <summary>Maintenance e-mails, tested without SMTP: a fake queue collects what the Domain would send.</summary>
public class MaintenanceMailTests
{
    class FakeQueue : IMailQueue
    {
        public bool Enabled { get; set; } = true;
        public string AppUrl => "";
        public List<MailItem> Sent { get; } = new();
        public void Enqueue(MailItem item) { if (Enabled) Sent.Add(item); }
    }

    static (CoreDb Core, OpsDb Ops, SqliteConnection[] Keep) Dbs()
    {
        var c1 = new SqliteConnection("Data Source=:memory:"); c1.Open();
        var c2 = new SqliteConnection("Data Source=:memory:"); c2.Open();
        var core = new CoreDb(new DbContextOptionsBuilder<CoreDb>().UseSqlite(c1).Options);
        var ops = new OpsDb(new DbContextOptionsBuilder<OpsDb>().UseSqlite(c2).Options);
        core.Database.EnsureCreated(); ops.Database.EnsureCreated();
        return (core, ops, new[] { c1, c2 });
    }

    static User U(string mail, Role role = Role.STUDENT, bool notify = true) =>
        new() { Name = "N", Surname = "S", Email = mail, PasswordHash = "x", Role = role, EmailNotifications = notify };

    [Fact] public async Task Maintenance_mails_every_student_with_notifications_on_but_nobody_twice()
    {
        var (core, ops, keep) = Dbs();
        using var _1 = keep[0]; using var _2 = keep[1];
        var a = U("a.one@student.tuke.sk"); var off = U("b.two@student.tuke.sk", notify: false);
        var booked = U("c.three@student.tuke.sk"); var admin = U("admin@lems.local", Role.ADMIN);
        core.Users.AddRange(a, off, booked, admin);
        var eq = new Equipment { InventoryNumber = "PRN-001", Title = "3D printer", Location = "Lab" };
        core.Equipment.Add(eq);
        await core.SaveChangesAsync();
        ops.Bookings.Add(new Booking { UserId = booked.Id, EquipmentId = eq.Id, Description = "print", Status = BookingStatus.PENDING,
            StartTime = DateTime.Now.AddDays(1), EndTime = DateTime.Now.AddDays(1).AddHours(1) });
        await ops.SaveChangesAsync();

        var q = new FakeQueue();
        var d = new Domain(core, ops, q);
        await d.SetMaintenance(eq, "the equipment was placed under maintenance");
        await ops.SaveChangesAsync();
        d.FlushMail();

        Assert.Equal(EquipmentStatus.MAINTENANCE, eq.Status);
        var unavailable = q.Sent.Where(m => m.Subject.Contains("equipment unavailable")).Select(m => m.To).ToList();
        Assert.Equal(new[] { "a.one@student.tuke.sk" }, unavailable);                         // not the muted student, the admin or the one with a booking
        Assert.Contains(q.Sent, m => m.To == "c.three@student.tuke.sk" && m.Subject.Contains("booking canceled"));   // he gets the cancellation instead
        Assert.Equal(2, q.Sent.Count);
        Assert.Contains("3D printer", q.Sent.First(m => m.To == "a.one@student.tuke.sk").Text);
    }

    [Fact] public async Task Nothing_is_sent_when_the_equipment_is_already_under_maintenance_or_mail_is_off()
    {
        var (core, ops, keep) = Dbs();
        using var _1 = keep[0]; using var _2 = keep[1];
        core.Users.Add(U("a.one@student.tuke.sk"));
        var eq = new Equipment { InventoryNumber = "X", Title = "Printer", Location = "Lab", Status = EquipmentStatus.MAINTENANCE };
        core.Equipment.Add(eq);
        await core.SaveChangesAsync();

        var q = new FakeQueue();
        var d = new Domain(core, ops, q);
        await d.SetMaintenance(eq, "again");                 // already in maintenance: no second broadcast
        d.FlushMail();
        Assert.Empty(q.Sent);

        eq.Status = EquipmentStatus.AVAILABLE;
        var off = new FakeQueue { Enabled = false };
        var d2 = new Domain(core, ops, off);
        await d2.SetMaintenance(eq, "no smtp");
        d2.FlushMail();
        Assert.Empty(off.Sent);
    }
}

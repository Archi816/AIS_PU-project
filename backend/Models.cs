using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lems;

public enum Role { STUDENT, ADMIN }
public enum EquipmentStatus { AVAILABLE, RESERVED, MAINTENANCE }
public enum BookingStatus { PENDING, CONFIRMED, REJECTED, CANCELED, IN_PROGRESS, FINISHED }
public enum RepairStatus { OPEN, CLOSED }

// =====================================================================================
//  CORE database (Azure SQL):  identity + equipment catalogue
// =====================================================================================
public class User
{
    public int Id { get; set; }
    [MaxLength(50)] public string Name { get; set; } = "";
    [MaxLength(50)] public string Surname { get; set; } = "";
    [MaxLength(100)] public string Email { get; set; } = "";
    [MaxLength(255)] public string PasswordHash { get; set; } = "";
    public Role Role { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class Equipment
{
    public int Id { get; set; }
    [MaxLength(10)] public string InventoryNumber { get; set; } = "";
    [MaxLength(25)] public string Title { get; set; } = "";
    [MaxLength(250)] public string Description { get; set; } = "";
    [MaxLength(20)] public string Location { get; set; } = "";
    [MaxLength(30)] public string Category { get; set; } = "";
    public EquipmentStatus Status { get; set; } = EquipmentStatus.AVAILABLE;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class UserSession   // server-side login session (cookie = random token, DB = its SHA-256)
{
    public int Id { get; set; }
    [MaxLength(64)] public string TokenHash { get; set; } = "";
    public int UserId { get; set; }
    public User? User { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

// =====================================================================================
//  OPS database (PostgreSQL):  bookings, repair requests, notifications, activity feed
//  UserId / EquipmentId point into the CORE database. There are NO cross-database foreign
//  keys and NO navigation properties - the application joins the two databases in code.
// =====================================================================================
public class Booking
{
    public int Id { get; set; }
    public int UserId { get; set; }          // -> Core.Users.Id
    public int EquipmentId { get; set; }     // -> Core.Equipment.Id
    public string Description { get; set; } = "";
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public BookingStatus Status { get; set; } = BookingStatus.PENDING;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class RepairRequest
{
    public int Id { get; set; }
    public int CreatedBy { get; set; }       // -> Core.Users.Id
    public int EquipmentId { get; set; }     // -> Core.Equipment.Id
    [MaxLength(50)] public string Title { get; set; } = "";
    [MaxLength(500)] public string Description { get; set; } = "";
    public RepairStatus Status { get; set; } = RepairStatus.OPEN;
    public bool Confirmed { get; set; }
    [MaxLength(30)] public string? Resolution { get; set; }   // RESOLVED | NO_REPAIR_REQUIRED
    public string? AiRecommendations { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class Notification
{
    public int Id { get; set; }
    public int UserId { get; set; }          // -> Core.Users.Id
    [MaxLength(500)] public string Message { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class ActivityEvent
{
    public int Id { get; set; }
    [MaxLength(500)] public string Message { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

static class ModelRules
{
    // snake_case column names to match the documented schema
    public static void SnakeColumns(ModelBuilder mb)
    {
        foreach (var et in mb.Model.GetEntityTypes())
            foreach (var p in et.GetProperties())
                p.SetColumnName(Regex.Replace(p.Name, "(?<!^)([A-Z])", "_$1").ToLowerInvariant());
    }
}

/// <summary>Application times are "lab wall-clock" times. Marking them Unspecified keeps Npgsql happy
/// (timestamp without time zone) and makes all providers behave identically.</summary>
public class UnspecifiedKindConverter : ValueConverter<DateTime, DateTime>
{
    public UnspecifiedKindConverter() : base(
        v => DateTime.SpecifyKind(v, DateTimeKind.Unspecified),
        v => DateTime.SpecifyKind(v, DateTimeKind.Unspecified)) { }
}

public class CoreDb(DbContextOptions<CoreDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Equipment> Equipment => Set<Equipment>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<Role>().HaveConversion<string>().HaveMaxLength(20);
        c.Properties<EquipmentStatus>().HaveConversion<string>().HaveMaxLength(20);
    }

    protected override void OnModelCreating(ModelBuilder mb)
    {
        mb.Entity<User>().HasIndex(u => u.Email).IsUnique();
        mb.Entity<Equipment>().HasIndex(e => e.InventoryNumber).IsUnique();
        mb.Entity<UserSession>().HasIndex(x => x.TokenHash).IsUnique();
        mb.Entity<UserSession>().HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        ModelRules.SnakeColumns(mb);
    }
}

public class OpsDb(DbContextOptions<OpsDb> options) : DbContext(options)
{
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<RepairRequest> RepairRequests => Set<RepairRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ActivityEvent> Activity => Set<ActivityEvent>();

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<BookingStatus>().HaveConversion<string>().HaveMaxLength(20);
        c.Properties<RepairStatus>().HaveConversion<string>().HaveMaxLength(20);
        c.Properties<DateTime>().HaveConversion<UnspecifiedKindConverter>();
        if (Database.ProviderName?.Contains("Npgsql") == true)
            c.Properties<DateTime>().HaveColumnType("timestamp without time zone");
    }

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // A slot (equipment + hour) can be held by only ONE active booking - enforced by the database itself,
        // so double booking is impossible even with several server instances.
        mb.Entity<Booking>().HasIndex(b => new { b.EquipmentId, b.StartTime }).IsUnique()
            .HasFilter("status IN ('PENDING','CONFIRMED','IN_PROGRESS')");
        // Optimistic concurrency: a status change fails if someone else changed the booking meanwhile.
        mb.Entity<Booking>().Property(b => b.Status).IsConcurrencyToken();
        mb.Entity<Booking>().HasIndex(b => b.UserId);
        mb.Entity<RepairRequest>().HasIndex(r => r.EquipmentId);
        mb.Entity<Notification>().HasIndex(n => n.UserId);
        ModelRules.SnakeColumns(mb);
    }
}

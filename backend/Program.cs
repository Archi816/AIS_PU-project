using System.Text.Json.Serialization;
using Lems;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ---- API only (UI: ../frontend). Two databases: CORE (Azure SQL: users, sessions, equipment) and OPS (PostgreSQL: bookings, repairs, notifications, activity) ----
// Provider per database: "SqlServer" | "Postgres" | "Sqlite" (Sqlite = local development without any cloud account)
static void UseProvider(DbContextOptionsBuilder o, IConfiguration cfg, string name)
{
    var provider = cfg[$"Databases:{name}:Provider"] ?? "Sqlite";
    var conn = cfg[$"Databases:{name}:ConnectionString"] ?? throw new InvalidOperationException($"Databases:{name}:ConnectionString is not configured");
    switch (provider.ToLowerInvariant())
    {
        case "sqlserver": o.UseSqlServer(conn, s => s.EnableRetryOnFailure()); break;
        case "postgres": o.UseNpgsql(conn, s => s.EnableRetryOnFailure()); break;
        case "sqlite": o.UseSqlite(conn); break;
        default: throw new InvalidOperationException($"Unknown database provider '{provider}' for {name}");
    }
}
builder.Services.AddDbContext<CoreDb>(o => UseProvider(o, builder.Configuration, "Core"));
builder.Services.AddDbContext<OpsDb>(o => UseProvider(o, builder.Configuration, "Ops"));

builder.Services.Configure<LemsOptions>(builder.Configuration.GetSection("Lems"));
builder.Services.Configure<SecurityOptions>(builder.Configuration.GetSection("Security"));
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddScoped<AiClient>();
builder.Services.AddHttpClient("ai", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["AiService:BaseUrl"] ?? "http://127.0.0.1:8000");
    c.Timeout = TimeSpan.FromSeconds(90);   // provider timeout is 60 s plus search (API_CONTRACT.md)
});
// E-mail (MailKit/SMTP). Without Smtp:Host the channel is off and everything else works as before.
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection("Smtp"));
builder.Services.AddSingleton<MailQueue>();
builder.Services.AddSingleton<IMailQueue>(sp => sp.GetRequiredService<MailQueue>());
builder.Services.AddHostedService<MailWorker>();
builder.Services.AddHostedService<LifecycleWorker>();

// The web UI is a separate container (frontend/, nginx) that proxies /api to this service. Behind that proxy the
// real client address and protocol arrive in X-Forwarded-* headers (login throttling and the Secure cookie need them).
// Enabled only with Security:BehindProxy=true: the headers are trusted blindly, so this service must NOT be published
// directly to the internet in that mode (docker-compose publishes only the frontend).
var behindProxy = builder.Configuration.GetValue<bool>("Security:BehindProxy");
if (behindProxy)
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        o.KnownNetworks.Clear();
        o.KnownProxies.Clear();
    });
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var core = scope.ServiceProvider.GetRequiredService<CoreDb>();
    var ops = scope.ServiceProvider.GetRequiredService<OpsDb>();
    core.Database.EnsureCreated();
    ops.Database.EnsureCreated();
    SchemaUpgrade.Core(core, app.Logger);   // adds columns introduced after the first release to existing databases
    // No migrations yet: EnsureCreated only builds a NEW database. Fail early with a clear message if an older one is in use.
    try { _ = core.EquipmentImages.Any(); _ = core.UserSessions.Any(); _ = ops.Notifications.Any(); }
    catch (Exception ex)
    {
        throw new InvalidOperationException("The database schema is older than this version (a table is missing). " +
            "Development: stop the app and delete lems-core.db and lems-ops.db (they are re-created and re-seeded). " +
            "Cloud databases: drop the LEMS tables or add migrations. Details: " + ex.Message, ex);
    }
    Seed.Run(core, ops, app.Environment.IsDevelopment(), app.Configuration, app.Logger);
}

if (behindProxy) app.UseForwardedHeaders();

var requireHttps = app.Configuration.GetValue<bool>("Security:RequireHttps");
if (requireHttps) { app.UseHsts(); app.UseHttpsRedirection(); }

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "same-origin";
    h["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'";
    if (ctx.Request.Path.StartsWithSegments("/api")) h["Cache-Control"] = "no-store";
    await next();
});

// No static files here any more: the UI lives in frontend/ and is served by its own container.
app.UseMiddleware<SessionMiddleware>();
Api.Map(app);
app.Run();

static class Seed
{
    public static void Run(CoreDb core, OpsDb ops, bool dev, IConfiguration cfg, ILogger log)
    {
        if (core.Users.Any()) return;
        // Demo accounts and sample data exist ONLY in Development. In production the first admin comes from configuration.
        if (dev)
        {
            core.Users.AddRange(
                new User { Name = "Admin", Surname = "LEMS", Email = "admin@lems.local", PasswordHash = Security.Hash("Admin123!"), Role = Role.ADMIN },
                new User { Name = "Jan", Surname = "Novak", Email = "jan.novak@student.tuke.sk", PasswordHash = Security.Hash("Student123!"), Role = Role.STUDENT });
            Equipment E(string inv, string t, string cat, string loc, string d) =>
                new() { InventoryNumber = inv, Title = t, Category = cat, Location = loc, Description = d };
            // Inventory numbers = equipment IDs of the AI service catalog (ai-service/data/equipment_seed.json),
            // because the AI service looks the equipment up by this ID.
            core.Equipment.AddRange(
                E("PC-001", "Laboratory workstation", "Computing", "Computing Lab", "Desktop computer for laboratory work."),
                E("LAP-001", "Student laptop", "Computing", "Loan Desk", "Laptop available for loan to students."),
                E("PRN-001", "3D printer", "Prototyping", "Prototyping Lab", "FDM 3D printer."),
                E("ROB-001", "Mobile robot", "Robotics", "Robotics Lab", "Educational mobile robot."),
                E("ARD-001", "Arduino development kit", "Electronics", "Electronics Lab", "Arduino board with USB programmer and components."),
                E("RPI-001", "Raspberry Pi kit", "Computing", "Electronics Lab", "Raspberry Pi single-board computer kit."),
                E("MUL-001", "Digital multimeter", "Measurement", "Electronics Lab", "Handheld digital multimeter."));
            ops.Activity.Add(new ActivityEvent { Message = "LEMS has been initialised with sample laboratory equipment." });
            ops.SaveChanges();
        }
        else
        {
            var email = cfg["Seed:AdminEmail"]; var pw = cfg["Seed:AdminPassword"];
            if (string.IsNullOrWhiteSpace(email) || Security.PasswordProblem(pw) != null)
            {
                log.LogWarning("No users exist. Set Seed:AdminEmail and Seed:AdminPassword (env vars Seed__AdminEmail / Seed__AdminPassword) to create the first administrator.");
                return;
            }
            core.Users.Add(new User { Name = "Admin", Surname = "LEMS", Email = email.Trim().ToLowerInvariant(), PasswordHash = Security.Hash(pw!), Role = Role.ADMIN });
        }
        core.SaveChanges();
    }
}

// needed by WebApplicationFactory<Program> in tests/backend
public partial class Program { }

using System.Text.Json.Serialization;
using Lems;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ---- two databases: CORE (Azure SQL: users, sessions, equipment) and OPS (PostgreSQL: bookings, repairs, notifications, activity) ----
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
    c.BaseAddress = new Uri(builder.Configuration["AiService:BaseUrl"] ?? "http://localhost:8001");
    c.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHostedService<LifecycleWorker>();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var core = scope.ServiceProvider.GetRequiredService<CoreDb>();
    var ops = scope.ServiceProvider.GetRequiredService<OpsDb>();
    core.Database.EnsureCreated();
    ops.Database.EnsureCreated();
    Seed.Run(core, ops, app.Environment.IsDevelopment(), app.Configuration, app.Logger);
}

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

app.UseDefaultFiles();
app.UseStaticFiles();
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
            core.Equipment.AddRange(
                E("INV-001", "Digital Oscilloscope", "Electronics", "Lab A-101", "4-channel 200 MHz oscilloscope."),
                E("INV-002", "Bench Power Supply", "Electronics", "Lab A-101", "Dual output 0-30 V / 5 A programmable supply."),
                E("INV-003", "Optical Microscope", "Optics", "Lab B-204", "Binocular microscope with 4x-100x objectives."),
                E("INV-004", "Spectrophotometer", "Chemistry", "Lab C-012", "UV-Vis spectrophotometer, 190-1100 nm."),
                E("INV-005", "Centrifuge", "Chemistry", "Lab C-012", "Benchtop centrifuge up to 15 000 rpm."),
                E("INV-006", "3D Printer", "Fabrication", "Lab D-003", "FDM printer, 220x220x250 mm build volume."),
                E("INV-007", "Logic Analyzer", "Electronics", "Lab A-102", "16-channel USB logic analyzer."),
                E("INV-008", "Laser Cutter", "Fabrication", "Lab D-003", "40 W CO2 laser cutter."));
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

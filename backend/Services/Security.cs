using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Lems;

public record Me(int Id, Role Role);

public class SecurityOptions
{
    public bool RequireHttps { get; set; } = false;   // true in production (HTTPS redirect, HSTS, Secure cookie)
    public int IdleMinutes { get; set; } = 480;       // session expires after this much inactivity
    public int AbsoluteHours { get; set; } = 24;      // ...and never lives longer than this
}

public static class Security
{
    public const string CookieName = ".lems.sid";
    const int Iterations = 600_000;                   // OWASP recommendation for PBKDF2-HMAC-SHA256

    // ---------- passwords: PBKDF2-SHA256, format iterations.salt.hash (base64) ----------
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        try
        {
            var parts = stored.Split('.');
            var iter = int.Parse(parts[0]);
            var salt = Convert.FromBase64String(parts[1]);
            var expected = Convert.FromBase64String(parts[2]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iter, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; }
    }

    public static bool NeedsRehash(string stored) =>
        !int.TryParse(stored.Split('.')[0], out var it) || it < Iterations;

    static readonly Lazy<string> DummyHash = new(() => Hash("dummy-password-for-timing"));
    /// <summary>Burns the same CPU time as a real check so unknown emails can't be told apart by response time.</summary>
    public static void FakeVerify(string password) => Verify(password, DummyHash.Value);

    public static string? PasswordProblem(string? pw)
    {
        if (string.IsNullOrEmpty(pw) || pw.Length < 8) return "Password must have at least 8 characters";
        if (pw.Length > 128) return "Password is too long (max 128 characters)";
        if (!pw.Any(char.IsLetter) || !pw.Any(char.IsDigit)) return "Password must contain at least one letter and one digit";
        return null;
    }

    // ---------- server-side sessions (stored in the database) ----------
    static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Creates a brand-new session (new random id every login = no session fixation).</summary>
    public static async Task SignInAsync(HttpContext http, User u)
    {
        await SignOutAsync(http);   // drop whatever session the browser had before
        var db = http.RequestServices.GetRequiredService<CoreDb>();
        var o = http.RequestServices.GetRequiredService<IOptions<SecurityOptions>>().Value;
        var token = NewToken();
        var now = DateTime.UtcNow;
        db.UserSessions.Add(new UserSession
        {
            TokenHash = TokenHash(token), UserId = u.Id, CreatedAt = now, LastSeenAt = now, ExpiresAt = now.AddHours(o.AbsoluteHours)
        });
        await db.SaveChangesAsync();
        http.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true, IsEssential = true, Path = "/", SameSite = SameSiteMode.Lax,
            Secure = o.RequireHttps || http.Request.IsHttps, MaxAge = TimeSpan.FromHours(o.AbsoluteHours)
        });
        http.Items["me"] = new Me(u.Id, u.Role);
    }

    /// <summary>Server-side logout: the session row is deleted, so the cookie is worthless afterwards.</summary>
    public static async Task SignOutAsync(HttpContext http)
    {
        var token = http.Request.Cookies[CookieName];
        if (!string.IsNullOrEmpty(token))
        {
            var db = http.RequestServices.GetRequiredService<CoreDb>();
            var h = TokenHash(token);
            await db.UserSessions.Where(s => s.TokenHash == h).ExecuteDeleteAsync();
            http.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
        }
        http.Items.Remove("me");
    }

    /// <summary>The authenticated user of this request (resolved by SessionMiddleware), or null.</summary>
    public static Me? Current(HttpContext http) => http.Items["me"] as Me;
}

/// <summary>Resolves the session cookie on every /api request and applies CSRF protection to state-changing calls.</summary>
public class SessionMiddleware(RequestDelegate next, IOptions<SecurityOptions> opt)
{
    static bool SameOrigin(HttpRequest r)
    {
        var origin = r.Headers.Origin.ToString();
        if (origin.Length == 0) return true;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var u)) return false;
        return string.Equals(u.Authority, r.Host.Value, StringComparison.OrdinalIgnoreCase);
    }

    public async Task InvokeAsync(HttpContext http, CoreDb db)
    {
        if (!http.Request.Path.StartsWithSegments("/api")) { await next(http); return; }

        // CSRF: cross-site pages can't send a custom header without a CORS preflight (CORS is not enabled),
        // and the Origin header must match this host. Combined with SameSite=Lax cookies.
        var m = http.Request.Method;
        if (!HttpMethods.IsGet(m) && !HttpMethods.IsHead(m) && !HttpMethods.IsOptions(m))
        {
            if (http.Request.Headers["X-Requested-With"] != "LEMS" || !SameOrigin(http.Request))
            {
                http.Response.StatusCode = StatusCodes.Status403Forbidden;
                await http.Response.WriteAsJsonAsync(new { error = "Request blocked (CSRF protection)" });
                return;
            }
        }

        var token = http.Request.Cookies[Security.CookieName];
        if (!string.IsNullOrEmpty(token))
        {
            var h = Security.TokenHash(token);
            var s = await db.UserSessions.Include(x => x.User).FirstOrDefaultAsync(x => x.TokenHash == h);
            var now = DateTime.UtcNow;
            if (s?.User != null && s.ExpiresAt > now && s.LastSeenAt.AddMinutes(opt.Value.IdleMinutes) > now)
            {
                http.Items["me"] = new Me(s.UserId, s.User.Role);   // role is read from the DB on every request
                if (now - s.LastSeenAt > TimeSpan.FromMinutes(1)) { s.LastSeenAt = now; await db.SaveChangesAsync(); }
            }
            else if (s != null) { db.UserSessions.Remove(s); await db.SaveChangesAsync(); }
        }
        await next(http);
    }
}

/// <summary>Temporary throttling of repeated failed logins (never a permanent lock-out, see BR-AUTH-04).</summary>
public class LoginThrottle
{
    static readonly TimeSpan Window = TimeSpan.FromMinutes(5);
    readonly Dictionary<string, (int Fails, DateTime Start)> map = new();

    public bool IsBlocked(string key, int limit, out int retryAfterSeconds)
    {
        lock (map)
        {
            retryAfterSeconds = 0;
            if (!map.TryGetValue(key, out var e)) return false;
            var left = e.Start + Window - DateTime.UtcNow;
            if (left <= TimeSpan.Zero) { map.Remove(key); return false; }
            if (e.Fails < limit) return false;
            retryAfterSeconds = (int)Math.Ceiling(left.TotalSeconds);
            return true;
        }
    }

    public void Fail(string key)
    {
        lock (map)
        {
            var now = DateTime.UtcNow;
            if (map.Count > 5000) foreach (var k in map.Where(x => x.Value.Start + Window < now).Select(x => x.Key).ToList()) map.Remove(k);
            map[key] = map.TryGetValue(key, out var e) && e.Start + Window > now ? (e.Fails + 1, e.Start) : (1, now);
        }
    }

    public void Reset(string key) { lock (map) map.Remove(key); }
}

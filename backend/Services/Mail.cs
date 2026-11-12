using System.Globalization;
using System.Net;
using System.Text;
using System.Threading.Channels;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Lems;

/// <summary>SMTP settings (env vars Smtp__Host, Smtp__Port, Smtp__User, Smtp__Password, Smtp__From, Smtp__PublicUrl).
/// With an empty Host the e-mail channel is simply switched off.</summary>
public class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string From { get; set; } = "LEMS <no-reply@lems.local>";
    /// <summary>Public address of the web UI, used for the "Open LEMS" link in e-mails (optional).</summary>
    public string PublicUrl { get; set; } = "";
}

public enum MailKind { Received, Confirmed, Rejected, Canceled }

/// <summary>One outgoing message. Ics (optional) is sent as a text/calendar attachment with IcsMethod PUBLISH or CANCEL.</summary>
public record MailItem(string To, string Subject, string Text, string Html, string? Ics = null, string? IcsMethod = null, string? IcsName = null);

public interface IMailQueue
{
    bool Enabled { get; }
    string AppUrl { get; }
    void Enqueue(MailItem item);
}

/// <summary>In-memory queue. Sending happens in MailWorker, so a slow or broken SMTP server never slows down or breaks a booking.</summary>
public class MailQueue(IOptions<SmtpOptions> opt) : IMailQueue
{
    readonly Channel<MailItem> channel = Channel.CreateBounded<MailItem>(new BoundedChannelOptions(2000) { FullMode = BoundedChannelFullMode.DropWrite });
    public bool Enabled => !string.IsNullOrWhiteSpace(opt.Value.Host);
    public string AppUrl => opt.Value.PublicUrl?.Trim() ?? "";
    public ChannelReader<MailItem> Reader => channel.Reader;
    public void Enqueue(MailItem item) { if (Enabled) channel.Writer.TryWrite(item); }
}

/// <summary>Background sender (MailKit). Two attempts per message; a failure is only logged.</summary>
public class MailWorker(MailQueue queue, IOptions<SmtpOptions> opt, ILogger<MailWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var item in queue.Reader.ReadAllAsync(ct))
            {
                for (var attempt = 1; attempt <= 2; attempt++)
                {
                    try { await Send(item, ct); break; }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        if (attempt == 2) log.LogError("E-mail to {To} could not be sent: {Msg}", item.To, ex.Message);
                        else { log.LogWarning("E-mail to {To} failed ({Msg}), retrying", item.To, ex.Message); await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                    }
                }
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }

    async Task Send(MailItem item, CancellationToken ct)
    {
        var o = opt.Value;
        var msg = new MimeMessage();
        msg.From.Add(MailboxAddress.Parse(o.From));
        msg.To.Add(MailboxAddress.Parse(item.To));
        msg.Subject = item.Subject;
        var body = new BodyBuilder { TextBody = item.Text, HtmlBody = item.Html };
        if (item.Ics != null)
            body.Attachments.Add(item.IcsName ?? "booking.ics", Encoding.UTF8.GetBytes(item.Ics),
                ContentType.Parse($"text/calendar; charset=utf-8; method={item.IcsMethod ?? "PUBLISH"}"));
        msg.Body = body.ToMessageBody();

        using var client = new SmtpClient();
        await client.ConnectAsync(o.Host, o.Port, SecureSocketOptions.Auto, ct);   // Auto: 465 = SSL, 587 = STARTTLS
        if (!string.IsNullOrWhiteSpace(o.User)) await client.AuthenticateAsync(o.User, o.Password, ct);
        await client.SendAsync(msg, ct);
        await client.DisconnectAsync(true, ct);
    }
}

/// <summary>iCalendar (.ics) events. Times are the lab's wall-clock times, written as "floating" local time, which every calendar app shows as-is.</summary>
public static class Ics
{
    static string Esc(string s) => s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r\n", "\\n").Replace("\n", "\\n");

    /// <summary>RFC 5545: lines are folded at 75 octets.</summary>
    static string Fold(string line)
    {
        var sb = new StringBuilder(); var octets = 0;
        foreach (var r in line.EnumerateRunes())
        {
            var n = r.Utf8SequenceLength;
            if (octets + n > 74) { sb.Append("\r\n "); octets = 1; }
            sb.Append(r.ToString()); octets += n;
        }
        return sb.ToString();
    }

    static string Stamp(DateTime t) => t.ToString("yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);

    /// <param name="method">PUBLISH (confirmed booking) or CANCEL (removes the event again: same UID, higher SEQUENCE)</param>
    public static string Event(Booking b, string title, string location, string method)
    {
        var cancel = method == "CANCEL";
        var lines = new List<string>
        {
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LEMS//Booking//EN", "CALSCALE:GREGORIAN", $"METHOD:{method}",
            "BEGIN:VEVENT",
            $"UID:booking-{b.Id}@lems",
            $"DTSTAMP:{DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture)}",
            $"DTSTART:{Stamp(b.StartTime)}",
            $"DTEND:{Stamp(b.EndTime)}",
            $"SUMMARY:{Esc("LEMS: " + title)}",
            $"LOCATION:{Esc(location)}",
            $"DESCRIPTION:{Esc(b.Description ?? "")}",
            $"STATUS:{(cancel ? "CANCELLED" : "CONFIRMED")}",
            $"SEQUENCE:{(cancel ? 1 : 0)}",
            "END:VEVENT", "END:VCALENDAR"
        };
        return string.Join("\r\n", lines.Select(Fold)) + "\r\n";
    }

    /// <summary>Plain link that pre-fills a Google Calendar event (no OAuth, no API).</summary>
    public static string GoogleLink(Booking b, string title, string location) =>
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        $"&text={Uri.EscapeDataString("LEMS: " + title)}&dates={Stamp(b.StartTime)}/{Stamp(b.EndTime)}" +
        $"&details={Uri.EscapeDataString(b.Description ?? "")}&location={Uri.EscapeDataString(location)}";
}

/// <summary>Texts of the e-mails (plain text + small HTML version).</summary>
public static class MailTemplates
{
    static string H(string s) => WebUtility.HtmlEncode(s);

    static MailItem Build(string to, string subject, string greeting, IEnumerable<string> paragraphs, IEnumerable<(string Label, string Value)> details,
        string appUrl, string? link, string? linkText, string? ics, string? method, string? icsName)
    {
        var paras = paragraphs.ToList(); var det = details.ToList();
        var text = new StringBuilder(greeting + "\n\n");
        foreach (var p in paras) text.Append(p + "\n\n");
        foreach (var (l, v) in det) text.Append($"{l}: {v}\n");
        if (link != null) text.Append($"\n{linkText}: {link}\n");
        if (appUrl.Length > 0) text.Append($"\nOpen LEMS: {appUrl}\n");
        text.Append("\n--\nYou receive this message because e-mail notifications are enabled in your LEMS profile.\n");

        var html = new StringBuilder("<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#1C1C1E;max-width:560px\">");
        html.Append($"<p style=\"font-weight:700;font-size:16px;margin:0 0 14px\">LEMS<span style=\"color:#4F46E5\">.</span></p><p>{H(greeting)}</p>");
        foreach (var p in paras) html.Append($"<p>{H(p)}</p>");
        html.Append("<table style=\"border-collapse:collapse;margin:12px 0\">");
        foreach (var (l, v) in det) html.Append($"<tr><td style=\"padding:3px 14px 3px 0;color:#8A8A93\">{H(l)}</td><td style=\"padding:3px 0\">{H(v)}</td></tr>");
        html.Append("</table>");
        if (link != null) html.Append($"<p><a href=\"{H(link)}\" style=\"background:#4F46E5;color:#fff;padding:8px 14px;border-radius:7px;text-decoration:none\">{H(linkText ?? "Open")}</a></p>");
        if (appUrl.Length > 0) html.Append($"<p><a href=\"{H(appUrl)}\">Open LEMS</a></p>");
        html.Append("<p style=\"color:#8A8A93;font-size:12px\">You receive this message because e-mail notifications are enabled in your LEMS profile.</p></div>");
        return new MailItem(to, subject, text.ToString(), html.ToString(), ics, method, icsName);
    }

    public static MailItem ForBooking(MailKind kind, Booking b, Equipment? e, User u, string? reason, bool wasConfirmed, string appUrl)
    {
        var title = e?.Title ?? "the equipment"; var loc = e?.Location ?? "";
        var details = new List<(string, string)>
        {
            ("Equipment", e == null ? title : $"{e.Title} (Inventory No.: {e.InventoryNumber})"),
            ("Location", loc.Length > 0 ? loc : "-"),
            ("Date and time", $"{b.StartTime:dd.MM.yyyy HH:mm}-{b.EndTime:HH:mm}"),
            ("Purpose", b.Description ?? "")
        };
        var greeting = $"Hello {u.Name},";
        switch (kind)
        {
            case MailKind.Received:
                return Build(u.Email, $"LEMS: booking request received - {title}", greeting,
                    new[] { "Your booking request has been received and is waiting for an administrator's decision. The time slot is held for you. You will get another e-mail as soon as it is confirmed or rejected." },
                    details, appUrl, null, null, null, null, null);
            case MailKind.Confirmed:
                return Build(u.Email, $"LEMS: booking confirmed - {title}", greeting,
                    new[] { "Your booking has been confirmed. The attached calendar file (.ics) works with Google Calendar, Outlook and Apple Calendar." },
                    details, appUrl, Ics.GoogleLink(b, title, loc), "Add to Google Calendar",
                    Ics.Event(b, title, loc, "PUBLISH"), "PUBLISH", $"booking-{b.Id}.ics");
            case MailKind.Rejected:
                return Build(u.Email, $"LEMS: booking rejected - {title}", greeting,
                    new[] { "Unfortunately your booking request has been rejected by an administrator. The time slot is free again - you can book another one." },
                    details, appUrl, null, null, null, null, null);
            default:
                return Build(u.Email, $"LEMS: booking canceled - {title}", greeting,
                    new[] { reason is { Length: > 0 } ? $"Your booking has been canceled: {reason}." : "Your booking has been canceled." + (wasConfirmed ? " The attached file removes the event from your calendar." : "") },
                    details, appUrl, null, null,
                    wasConfirmed ? Ics.Event(b, title, loc, "CANCEL") : null, wasConfirmed ? "CANCEL" : null, wasConfirmed ? $"booking-{b.Id}.ics" : null);
        }
    }

    public static MailItem ForUnavailable(User u, Equipment e, string reason, string appUrl) =>
        Build(u.Email, $"LEMS: equipment unavailable - {e.Title}", $"Hello {u.Name},",
            new[] { $"{e.Title} is temporarily unavailable: {reason}. It cannot be booked until it is back in service." },
            new[] { ("Equipment", $"{e.Title} (Inventory No.: {e.InventoryNumber})"), ("Location", e.Location.Length > 0 ? e.Location : "-") },
            appUrl, null, null, null, null, null);

    public static MailItem Text(User u, string subject, string message, string appUrl) =>
        Build(u.Email, subject, $"Hello {u.Name},", new[] { message }, Array.Empty<(string, string)>(), appUrl, null, null, null, null, null);
}

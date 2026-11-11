using Microsoft.EntityFrameworkCore;

namespace Lems;

/// <summary>
/// The project has no EF migrations: EnsureCreated builds a NEW database only. Columns that were added after the first
/// release are added here to databases that already exist. Every statement is idempotent (safe to run on every start).
/// Only the CORE database changed (OPS has no new columns).
/// </summary>
public static class SchemaUpgrade
{
    // (table, column, SQL Server type, Postgres type, SQLite type, default literal)
    static readonly (string Table, string Column, string SqlServer, string Postgres, string Sqlite, string Default)[] Columns =
    {
        ("Equipment", "specifications", "nvarchar(1000)", "varchar(1000)", "TEXT", "''"),
        ("Equipment", "contact_name", "nvarchar(50)", "varchar(50)", "TEXT", "''"),
        ("Equipment", "contact_email", "nvarchar(100)", "varchar(100)", "TEXT", "''"),
        ("Users", "email_notifications", "bit", "boolean", "INTEGER", "1"),
    };

    public static void Core(CoreDb core, ILogger log)
    {
        var provider = core.Database.ProviderName ?? "";
        foreach (var c in Columns)
        {
            try
            {
                if (provider.Contains("SqlServer"))
                    core.Database.ExecuteSqlRaw($"IF COL_LENGTH('{c.Table}', '{c.Column}') IS NULL ALTER TABLE [{c.Table}] ADD [{c.Column}] {c.SqlServer} NOT NULL CONSTRAINT [DF_{c.Table}_{c.Column}] DEFAULT {c.Default}");
                else if (provider.Contains("Npgsql"))
                    core.Database.ExecuteSqlRaw($"ALTER TABLE \"{c.Table}\" ADD COLUMN IF NOT EXISTS \"{c.Column}\" {c.Postgres} NOT NULL DEFAULT {c.Default}");
                else if (provider.Contains("Sqlite") && !SqliteHasColumn(core, c.Table, c.Column))
                    core.Database.ExecuteSqlRaw($"ALTER TABLE \"{c.Table}\" ADD COLUMN \"{c.Column}\" {c.Sqlite} NOT NULL DEFAULT {c.Default}");
            }
            catch (Exception ex)
            {
                log.LogWarning("Schema upgrade of {Table}.{Column} failed: {Msg}", c.Table, c.Column, ex.Message);
            }
        }
    }

    static bool SqliteHasColumn(CoreDb core, string table, string column)
    {
        var conn = core.Database.GetDbConnection();
        var wasClosed = conn.State != System.Data.ConnectionState.Open;
        if (wasClosed) conn.Open();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'";   // constants only, no user input
            return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
        }
        finally { if (wasClosed) conn.Close(); }
    }
}

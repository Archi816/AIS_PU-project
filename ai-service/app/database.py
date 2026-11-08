"""Small SQL adapter: SQLite for development, PostgreSQL for shared deployment."""
import re
import sqlite3
from contextlib import contextmanager, suppress
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import psycopg
from psycopg.rows import dict_row
from app.config import ROOT, settings


class DatabaseUnavailable(Exception):
    pass


def database_path():
    return Path(settings().get('LEMS_CATALOG_PATH') or ROOT / 'data' / 'equipment.db')


def database_url():
    config = settings()
    url = (config.get('DATABASE_URL') or '').strip()
    production = config.get('APP_ENV', 'development') == 'production'
    if url:
        try:
            parsed = urlsplit(url)
        except ValueError:
            raise DatabaseUnavailable() from None
        if parsed.scheme not in ('postgresql', 'postgres') or not parsed.hostname or not parsed.path.strip('/'):
            raise DatabaseUnavailable()
        if production:
            query = parse_qs(parsed.query)
            if query.get('sslmode') != ['verify-full'] or not query.get('sslrootcert'):
                raise DatabaseUnavailable()
    elif production:
        raise DatabaseUnavailable()
    return url


class Connection:
    """SQL statements use named parameters in both engines; values never interpolated."""
    def __init__(self, raw, postgres):
        self.raw, self.postgres = raw, postgres

    def sql(self, statement):
        if self.postgres:
            return re.sub(r'(?<!:):([A-Za-z_][A-Za-z_0-9]*)', r'%(\1)s', statement)
        return statement

    def execute(self, statement, params=None):
        return self.raw.execute(self.sql(statement), params or {})

    def executemany(self, statement, rows):
        with self.raw.cursor() if self.postgres else _sqlite_cursor(self.raw) as cursor:
            cursor.executemany(self.sql(statement), rows)


@contextmanager
def _sqlite_cursor(raw):
    cursor = raw.cursor()
    try:
        yield cursor
    finally:
        cursor.close()


@contextmanager
def connect(write=False):
    raw = None
    try:
        url = database_url()
        if url:
            raw = psycopg.connect(url, row_factory=dict_row, connect_timeout=5)
            raw.read_only = not write
            raw.execute("SET LOCAL statement_timeout = '10s'")
        else:
            path = database_path()
            if write:
                path.parent.mkdir(parents=True, exist_ok=True)
                raw = sqlite3.connect(path, timeout=5)
            else:
                raw = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
            raw.row_factory = sqlite3.Row
        yield Connection(raw, bool(url))
        if write:
            raw.commit()
    except (sqlite3.Error, psycopg.Error, ValueError, OSError):
        if raw is not None:
            with suppress(sqlite3.Error, psycopg.Error):
                raw.rollback()
        raise DatabaseUnavailable() from None
    finally:
        if raw is not None:
            raw.close()

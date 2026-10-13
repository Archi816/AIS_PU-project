"""One-table local catalog. No fetching of URLs supplied by users or the model."""
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class EquipmentNotFound(Exception):
    pass

class CatalogUnavailable(Exception):
    pass

def database_path():
    return Path(os.environ.get("LEMS_CATALOG_PATH", str(ROOT / "data" / "equipment.db")))

def initialize():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = json.loads((ROOT / "data" / "equipment_seed.json").read_text(encoding="utf-8"))
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS equipment (
            id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL,
            model TEXT, location TEXT NOT NULL, condition TEXT NOT NULL,
            documentation_url TEXT, documentation_text TEXT NOT NULL DEFAULT '',
            documentation_section TEXT, documentation_verified_at TEXT,
            is_demo INTEGER NOT NULL DEFAULT 1 CHECK (is_demo IN (0,1))
        )""")
        db.executemany("""INSERT INTO equipment VALUES (
            :id,:category,:name,:model,:location,:condition,:documentation_url,
            :documentation_text,:documentation_section,:documentation_verified_at,:is_demo
        ) ON CONFLICT(id) DO NOTHING""", rows)

def complete_demo_placeholders():
    """Assign seed assumptions only to matching demo placeholders, not real assets."""
    rows = json.loads((ROOT / "data" / "equipment_seed.json").read_text(encoding="utf-8"))
    with closing(sqlite3.connect(database_path())) as db, db:
        for row in rows:
            db.execute("""UPDATE equipment SET model=COALESCE(model,:model),
                location=CASE WHEN location='Not verified' THEN :location ELSE location END,
                condition=CASE WHEN condition='unknown' THEN :condition ELSE condition END
                WHERE id=:id AND is_demo=1 AND (model IS NULL OR model=:model)
                """, row)
    return fill_missing_documentation()


def fill_missing_documentation():
    """Fill empty documentation only for matching demo models; preserve user edits."""
    rows = json.loads((ROOT / "data" / "equipment_seed.json").read_text(encoding="utf-8"))
    updated = []
    with closing(sqlite3.connect(database_path())) as db, db:
        for row in rows:
            if not row["documentation_text"] or not row["documentation_verified_at"]:
                continue
            result = db.execute("""UPDATE equipment SET
                documentation_url=:documentation_url, documentation_text=:documentation_text,
                documentation_section=:documentation_section,
                documentation_verified_at=:documentation_verified_at
                WHERE id=:id AND model=:model AND is_demo=1 AND TRIM(documentation_text)=''
                """, row)
            if result.rowcount:
                updated.append(row["id"])
    return updated


def read_equipment(equipment_id=None):
    try:
        # Read-only mode: a missing DB must not silently become an empty file.
        with closing(sqlite3.connect(database_path().resolve().as_uri() + "?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            if equipment_id is None:
                return [dict(row) for row in db.execute("SELECT * FROM equipment ORDER BY id")]
            row = db.execute("SELECT * FROM equipment WHERE id = ?", (equipment_id,)).fetchone()
            if row is None:
                raise EquipmentNotFound()
            return dict(row)
    except sqlite3.Error:
        raise CatalogUnavailable() from None

def documentation_context(item):
    text = item["documentation_text"].strip()
    # Short, reviewed summaries are included whole. Reject oversized unreviewed imports.
    if not text or not item["documentation_verified_at"] or not item["documentation_url"]:
        return "", []
    if len(text) > 12000:
        raise CatalogUnavailable()
    return text, [{"url": item["documentation_url"],
                   "section": item["documentation_section"] or "Reviewed summary",
                   "verified_at": item["documentation_verified_at"]}]

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--fill-missing-docs", action="store_true")
    parser.add_argument("--complete-demo", action="store_true",
                        help="Assign proposed models/locations/states to demo placeholders only")
    args = parser.parse_args()
    initialize()
    if args.complete_demo:
        print("Demo documentation added:", complete_demo_placeholders())
    if args.fill_missing_docs:
        print("Documentation added:", fill_missing_documentation())
    print("Local equipment catalog initialized; existing rows preserved.")

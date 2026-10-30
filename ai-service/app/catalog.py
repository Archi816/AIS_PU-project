"""One-table local catalog. No fetching of URLs supplied by users or the model."""
import json
from pathlib import Path
from app.database import connect, DatabaseUnavailable

ROOT = Path(__file__).resolve().parents[1]

class EquipmentNotFound(Exception):
    pass

CatalogUnavailable = DatabaseUnavailable

def initialize():
    rows = json.loads((ROOT / "data" / "equipment_seed.json").read_text(encoding="utf-8"))
    for row in rows:
        row["is_demo"] = int(row["is_demo"])
    with connect(write=True) as db:
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

def read_equipment(equipment_id=None):
    with connect() as db:
        if equipment_id is None:
            return [dict(row) for row in db.execute("SELECT * FROM equipment ORDER BY id")]
        row = db.execute("SELECT * FROM equipment WHERE id = :id", {"id": equipment_id}).fetchone()
        if row is None:
            raise EquipmentNotFound()
        return dict(row)


def documentation_context(item):
    text = item["documentation_text"].strip()
    # Validate reviewed source text before semantic retrieval selects passages.
    if not text or not item["documentation_verified_at"] or not item["documentation_url"]:
        return "", []
    if len(text) > 12000:
        raise CatalogUnavailable()
    return text, [{"url": item["documentation_url"],
                   "section": item["documentation_section"] or "Reviewed summary",
                   "verified_at": item["documentation_verified_at"]}]

if __name__ == "__main__":
    initialize()
    print("Equipment catalog initialized; existing rows preserved.")

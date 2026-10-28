"""Explicit admin command: download complete selected sources and build a local-vector SQL index."""
import argparse
import hashlib
import io
import json
import os
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from dotenv import dotenv_values
from pypdf import PdfReader
from app.config import ROOT
from app.database import connect
from app.catalog import read_equipment
from app.embeddings import encoder, MODEL, LOCK

CACHE = ROOT / 'data' / 'document-cache'


def initialize():
    with connect(write=True) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS document_chunks (
            id TEXT PRIMARY KEY, equipment_id TEXT NOT NULL, equipment_model TEXT NOT NULL,
            url TEXT NOT NULL, title TEXT NOT NULL, section TEXT NOT NULL, page INTEGER,
            text TEXT NOT NULL, embedding TEXT NOT NULL, embedding_model TEXT NOT NULL,
            content_hash TEXT NOT NULL, retrieved_at TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS chunks_equipment ON document_chunks(equipment_id)')
        if db.postgres:
            db.execute('ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY')
            db.execute('REVOKE ALL ON document_chunks FROM PUBLIC')
            for role in ('anon', 'authenticated'):
                if db.execute('SELECT 1 FROM pg_roles WHERE rolname=:role', {'role': role}).fetchone():
                    db.execute(f'REVOKE ALL ON document_chunks FROM {role}')
            if db.execute("SELECT 1 FROM pg_roles WHERE rolname='lems_reader'").fetchone():
                db.execute('GRANT SELECT ON document_chunks TO lems_reader')
                db.execute('DROP POLICY IF EXISTS lems_reader_chunks ON document_chunks')
                db.execute('CREATE POLICY lems_reader_chunks ON document_chunks FOR SELECT TO lems_reader USING (true)')


def download(source, refresh=False):
    url = source['url']
    if not url.startswith('https://'):
        raise ValueError('Sources must use HTTPS')
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.bin')
    if path.exists() and not refresh:
        return path.read_bytes()
    parts, size = [], 0
    with httpx.stream('GET', url, follow_redirects=True, timeout=45) as response:
        response.raise_for_status()
        if response.url.scheme != 'https':
            raise ValueError('Insecure redirect')
        for part in response.iter_bytes():
            size += len(part)
            if size > 30 * 1024 * 1024:
                raise ValueError('Document exceeds 30 MB')
            parts.append(part)
    data = b''.join(parts)
    # Validate before caching: a challenge/login page must not become a manual.
    extract(source, data)
    path.write_bytes(data)
    return data


def extract(source, data):
    """Return (section, PDF page, text). No OCR or image interpretation."""
    if source['format'] == 'pdf':
        if not data.startswith(b'%PDF'):
            raise ValueError('Not a PDF')
        pages = PdfReader(io.BytesIO(data)).pages
        result = [(f'PDF page {i}', i, page.extract_text() or '')
                  for i, page in enumerate(pages, 1)]
        empty = sum(not text.strip() for _, _, text in result)
        if empty:
            print(f"  Warning: {empty} pages have no extractable text (no OCR).")
    else:
        soup = BeautifulSoup(data, 'html.parser')
        root = soup.select_one(source['selector'])
        if root is None:
            raise ValueError('Article selector not found')
        for node in root.select('script, style, nav, footer, button'):
            node.decompose()
        result, heading, lines = [], source['title'], []
        for node in root.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'pre', 'table']):
            if node.find_parent(['li', 'pre', 'table']):
                continue
            text = node.get_text(' ', strip=True)
            if node.name.startswith('h'):
                if lines:
                    result.append((heading, None, '\n'.join(lines)))
                heading, lines = text, []
            elif text:
                lines.append(text)
        if lines:
            result.append((heading, None, '\n'.join(lines)))
    if sum(len(text.strip()) for _, _, text in result) < 200:
        raise ValueError('Insufficient document text')
    return [(section, page, unicodedata.normalize("NFKC", text)) for section, page, text in result]


def split_text(text, size=160, overlap=30):
    words = text.split()
    for start in range(0, len(words), size - overlap):
        yield ' '.join(words[start:start + size])
        if start + size >= len(words):
            break


def index_source(source, refresh=False):
    item = read_equipment(source['equipment_id'])
    data = download(source, refresh)
    # Include extraction settings: changing a selector also invalidates the index.
    digest = hashlib.sha256(data + json.dumps(source, sort_keys=True).encode() + b'parser-v2').hexdigest()
    params = {'equipment_id': item['id'], 'url': source['url']}
    with connect() as db:
        previous = list(db.execute('''SELECT content_hash, embedding_model, equipment_model
            FROM document_chunks WHERE equipment_id=:equipment_id AND url=:url''', params))
    if previous and all(r['content_hash'] == digest and r['embedding_model'] == MODEL
                        and r['equipment_model'] == item['model'] for r in previous):
        return len(previous), 'unchanged'
    passages = [(section, page, chunk) for section, page, text in extract(source, data)
                for chunk in split_text(text) if chunk.strip()]
    with LOCK:
        vectors = list(encoder().passage_embed([p[2] for p in passages]))
    if len(vectors) != len(passages):
        raise ValueError('Incomplete embeddings')
    retrieved = datetime.now(timezone.utc).date().isoformat()
    rows = []
    for number, ((section, page, text), vector) in enumerate(zip(passages, vectors)):
        import numpy as np
        if not np.isfinite(vector).all():
            raise ValueError('Invalid embedding')
        rows.append(dict(id=hashlib.sha256(f"{item['id']}|{source['url']}|{number}".encode()).hexdigest(),
                         equipment_id=item['id'], equipment_model=item['model'], url=source['url'],
                         title=source['title'], section=section, page=page, text=text,
                         embedding=json.dumps([float(v) for v in vector]), embedding_model=MODEL,
                         content_hash=digest, retrieved_at=retrieved))
    # Replace only after successful extraction/embedding, in a single transaction.
    with connect(write=True) as db:
        db.execute('DELETE FROM document_chunks WHERE equipment_id=:equipment_id AND url=:url', params)
        db.executemany('''INSERT INTO document_chunks
            (id,equipment_id,equipment_model,url,title,section,page,text,embedding,embedding_model,content_hash,retrieved_at)
            VALUES (:id,:equipment_id,:equipment_model,:url,:title,:section,:page,:text,:embedding,:embedding_model,:content_hash,:retrieved_at)''', rows)
    return len(rows), 'indexed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data' / 'full_sources.json')
    parser.add_argument('--admin-env', type=Path, help='Explicit owner credentials file; never loaded by the service')
    parser.add_argument('--equipment', help='Index only this equipment ID')
    parser.add_argument('--refresh', action='store_true', help='Download again instead of using cached files')
    args = parser.parse_args()
    if args.admin_env:
        url = dotenv_values(args.admin_env).get('DATABASE_URL')
        if not url:
            parser.error('Admin file must contain DATABASE_URL')
        os.environ['DATABASE_URL'] = url
    sources = json.loads(args.manifest.read_text(encoding='utf-8'))
    initialize()
    failed = False
    for source in sources:
        if args.equipment and source['equipment_id'] != args.equipment:
            continue
        print(f"{source['equipment_id']}: {source['title']}", flush=True)
        try:
            count, status = index_source(source, args.refresh)
            print(f'  {status}: {count} passages', flush=True)
        except Exception as exc:
            # No raw exception: connection strings can contain secrets.
            print(f'  FAILED ({type(exc).__name__}); existing source index preserved.', flush=True)
            failed = True
    return int(failed)

if __name__ == '__main__':
    raise SystemExit(main())

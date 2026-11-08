"""Search separately indexed whole sources. Does not read summary documentation."""
import json
import re
import numpy as np
from app.database import connect, DatabaseUnavailable
from app.embeddings import MODEL, LOCK, encoder, RetrievalUnavailable

MIN_SCORE = 0.48
TOP_K = 4


def check_ready():
    try:
        with connect() as db:
            db.execute('SELECT id FROM document_chunks LIMIT 1').fetchone()
    except DatabaseUnavailable:
        raise RetrievalUnavailable() from None


def read_chunks(equipment_id, equipment_model):
    try:
        with connect() as db:
            return [dict(row) for row in db.execute('''SELECT * FROM document_chunks
                WHERE equipment_id=:id AND equipment_model=:model ORDER BY id''',
                {'id': equipment_id, 'model': equipment_model})]
    except DatabaseUnavailable:
        raise RetrievalUnavailable() from None


def retrieve(item, problem):
    rows = read_chunks(item['id'], item['model'])
    if not rows:
        return '', []
    try:
        if any(row['embedding_model'] != MODEL for row in rows):
            raise ValueError('Reindex required')
        vectors = np.array([json.loads(row['embedding']) for row in rows], dtype=np.float32)
        with LOCK:
            query = np.array(next(iter(encoder().query_embed(problem))), dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[1] != len(query) or not np.isfinite(vectors).all() or not np.isfinite(query).all():
            raise ValueError('Invalid stored vectors')
        vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
        query /= max(float(np.linalg.norm(query)), 1e-12)
        scores = vectors @ query
        # Exact diagnostic terms improve ordering without bypassing semantic relevance.
        terms = set(re.findall(r'[a-z0-9_]{3,}', problem.lower()))
        lexical = np.array([len(terms & set(re.findall(r'[a-z0-9_]{3,}', row['text'].lower())))
                            / max(len(terms), 1) for row in rows])
        ranked = np.argsort(-(scores + 0.08 * lexical))
        selected = [int(i) for i in ranked if scores[i] >= MIN_SCORE][:TOP_K]
    except Exception:
        raise RetrievalUnavailable() from None
    context, sources = [], []
    for index, row_index in enumerate(selected, 1):
        row = rows[row_index]
        source_id = f'S{index}'
        context.append(f"[{source_id}] {row['title']} | {row['section']}\n{row['text']}")
        url = row['url'] + (f"#page={row['page']}" if row['page'] else '')
        sources.append(dict(source_id=source_id, url=url, title=row['title'],
                            section=row['section'], page=row['page'], excerpt=row['text'],
                            retrieved_at=row['retrieved_at'], verified_at=''))
    return '\n\n'.join(context), sources

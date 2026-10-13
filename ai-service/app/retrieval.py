"""Local English semantic retrieval; no vector server or paid embedding API."""
from functools import lru_cache
from pathlib import Path
from threading import Lock

from app.catalog import documentation_context

MODEL = "BAAI/bge-small-en-v1.5"
CACHE = Path(__file__).resolve().parents[1] / "data" / "embedding-cache"
MIN_SCORE = 0.48  # Heuristic cutoff, NOT a probability of correctness.
_lock = Lock()


class RetrievalUnavailable(Exception):
    pass


@lru_cache(maxsize=1)
def encoder():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=MODEL, cache_dir=str(CACHE), threads=2,
                         local_files_only=True)


def chunks(text):
    """Overlapping 90-word windows fit the small model's input window."""
    words = text.split()
    result = []
    for start in range(0, len(words), 70):
        result.append(" ".join(words[start:start + 90]))
        if start + 90 >= len(words):
            break
    return tuple(result)


@lru_cache(maxsize=32)
def document_vectors(passages):
    import numpy as np
    vectors = np.array(list(encoder().passage_embed(list(passages))))
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)


def retrieve(item, problem):
    text, sources = documentation_context(item)
    if not text:
        return "", []
    passages = chunks(text)
    try:
        import numpy as np
        # Bound simultaneous CPU work. Documents are cached by content, not just ID.
        with _lock:
            vectors = document_vectors(passages)
            query = np.array(next(iter(encoder().query_embed(problem))))
            query = query / max(float(np.linalg.norm(query)), 1e-12)
            scores = vectors @ query
        selected = [int(i) for i in np.argsort(-scores)[:3] if scores[i] >= MIN_SCORE]
    except Exception:
        # Broken search must not silently masquerade as no evidence.
        raise RetrievalUnavailable() from None
    if not selected:
        return "", []
    context = "\n\n".join(f"[Excerpt {i + 1}] {passages[i]}" for i in sorted(selected))
    return context, sources


if __name__ == "__main__":
    from fastembed import TextEmbedding
    CACHE.mkdir(parents=True, exist_ok=True)
    model = TextEmbedding(model_name=MODEL, cache_dir=str(CACHE), threads=2)
    list(model.query_embed("Equipment diagnostic error"))
    print("English embedding model downloaded and checked. API can now search offline.")

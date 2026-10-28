"""Original search over equipment.documentation_text only."""
from functools import lru_cache
from app.catalog import documentation_context
from app.embeddings import encoder, RetrievalUnavailable, LOCK as _lock

MIN_SCORE = 0.48

def chunks(text):
    """Keep diagnostic topics separate; split only long paragraphs with overlap."""
    result = []
    for section in text.split("\n\n"):
        words = section.split()
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



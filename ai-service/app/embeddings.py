"""Shared local encoder; neither retrieval mode imports the other."""
from functools import lru_cache
from pathlib import Path
from threading import Lock

MODEL = "BAAI/bge-small-en-v1.5"
CACHE = Path(__file__).resolve().parents[1] / "data" / "embedding-cache"
LOCK = Lock()

class RetrievalUnavailable(Exception):
    pass

@lru_cache(maxsize=1)
def encoder():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=MODEL, cache_dir=str(CACHE), threads=2,
                         local_files_only=True)

def prepare():
    from fastembed import TextEmbedding
    CACHE.mkdir(parents=True, exist_ok=True)
    model = TextEmbedding(model_name=MODEL, cache_dir=str(CACHE), threads=2)
    list(model.query_embed("Equipment diagnostic error"))
    print("Local embedding model downloaded and checked.")

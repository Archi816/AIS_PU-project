"""Choose one independent retrieval implementation. No automatic fallback."""
from importlib import import_module
from app.config import settings
from app.embeddings import RetrievalUnavailable

MODULES = {"summary": "app.retrieval_summary", "full": "app.retrieval_full"}

def get_mode():
    mode = (settings().get("RETRIEVAL_MODE") or "summary").strip().lower()
    if mode not in MODULES:
        raise RetrievalUnavailable()
    return mode

def backend():
    try:
        return import_module(MODULES[get_mode()])
    except ImportError:
        raise RetrievalUnavailable() from None

def retrieve(item, problem):
    return backend().retrieve(item, problem)

def check_ready():
    module = backend()
    if get_mode() == "full":
        module.check_ready()

if __name__ == "__main__":
    from app.embeddings import prepare
    prepare()

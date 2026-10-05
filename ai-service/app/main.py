"""HTTP entry point for the LEMS AI service."""

from fastapi import FastAPI

app = FastAPI(
    title="LEMS AI Service",
    description="Equipment maintenance assistant API. Initial service setup.",
    version="0.1.0",
)


@app.get("/health", tags=["Health"])
def health() -> dict[str, str]:
    """Check that the service responds; no model or database check yet."""
    return {"status": "ok", "service": "lems-ai-service"}

"""HTTP entry point for the LEMS AI service."""

import logging
from uuid import uuid4
from time import perf_counter

from fastapi import FastAPI, Request, Depends, HTTPException
from contextlib import asynccontextmanager
from app.config import settings
from app.database import database_url
from app.security import require_service_key
from app.embeddings import encoder
from app.retrieval import check_ready, get_mode
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.catalog import read_equipment, EquipmentNotFound, CatalogUnavailable

from app.schemas import AnalysisRequest, AnalysisResponse, ErrorResponse
from app.model_service import ModelUnavailable, analyze_with_model
from app.retrieval import RetrievalUnavailable

@asynccontextmanager
async def lifespan(app):
    config = settings()
    if config.get("APP_ENV", "development") == "production":
        if len((config.get("LEMS_SERVICE_API_KEY") or "").strip()) < 32:
            raise RuntimeError("Configure a service access key before deployment.")
        try:
            database_url()
        except CatalogUnavailable:
            raise RuntimeError("Configure PostgreSQL with verified TLS before deployment.") from None
    yield


app = FastAPI(
    title="LEMS AI Service",
    description="English maintenance reports with local semantic retrieval and configurable model provider.",
    version="0.7.0",
    lifespan=lifespan,
    docs_url=None if settings().get("APP_ENV") == "production" else "/docs",
    redoc_url=None,
    openapi_url=None if settings().get("APP_ENV") == "production" else "/openapi.json",
)


@app.exception_handler(HTTPException)
async def access_error(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Do not echo user descriptions or internal validation details in error responses.
    return JSONResponse(status_code=422, content={"error": {
        "code": "VALIDATION_ERROR",
        "message": "Проверьте обязательные поля и их длину в документации API. Все значения должны быть непустыми строками; лишние поля не допускаются.",
    }})


@app.get("/health", tags=["Health"])
def health() -> dict[str, str]:
    """Check that the service responds; no model or database check yet."""
    return {"status": "ok", "service": "lems-ai-service"}


@app.post(
    "/api/v1/maintenance/analyze",
    tags=["Maintenance"],
    dependencies=[Depends(require_service_key)],
    response_model=AnalysisResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Invalid service access key"},
        404: {"model": ErrorResponse, "description": "Equipment not found"},
        422: {"model": ErrorResponse, "description": "Invalid request"},
        503: {"model": ErrorResponse, "description": "Model unavailable or not configured"},
    },
)
def analyze(payload: AnalysisRequest):
    """Return validated model output or a safe error without provider details."""
    request_id = uuid4().hex[:8]
    started = perf_counter()
    def progress(message):
        logging.getLogger("uvicorn.error").info("[%s +%.1fs] %s", request_id,
                                                perf_counter() - started, message)
    try:
        return analyze_with_model(payload, progress=progress)
    except EquipmentNotFound:
        progress("ERROR EQUIPMENT_NOT_FOUND")
        return JSONResponse(status_code=404, content={"error": {
            "code": "EQUIPMENT_NOT_FOUND", "message": "Select an existing equipment ID."}})
    except CatalogUnavailable:
        progress("ERROR CATALOG_UNAVAILABLE")
        return JSONResponse(status_code=503, content={"error": {
            "code": "CATALOG_UNAVAILABLE", "message": "Equipment catalog is unavailable."}})
    except RetrievalUnavailable:
        progress("ERROR RETRIEVAL_UNAVAILABLE")
        return JSONResponse(status_code=503, content={"error": {
            "code": "RETRIEVAL_UNAVAILABLE",
            "message": "Documentation search is unavailable. Prepare the local embedding model."}})
    except ModelUnavailable:
        progress("ERROR MODEL_UNAVAILABLE")
        return JSONResponse(status_code=503, content={"error": {
            "code": "MODEL_UNAVAILABLE",
            "message": "Сервис модели временно недоступен. Проверьте настройки подключения или повторите запрос позже.",
        }})


@app.get("/api/v1/equipment", tags=["Equipment"], dependencies=[Depends(require_service_key)])
def equipment_list():
    """Local demonstration inventory, not verified TUKE assets or availability."""
    try:
        return read_equipment()
    except CatalogUnavailable:
        return JSONResponse(status_code=503, content={"error": {
            "code": "CATALOG_UNAVAILABLE", "message": "Equipment catalog is unavailable."}})


@app.get("/ready", tags=["Health"], dependencies=[Depends(require_service_key)])
def ready():
    """Check catalog, local weights and provider config without a paid/free API call."""
    from app.model_service import azure_settings
    try:
        read_equipment()
        encoder()
        check_ready()
        config = settings()
        provider = config.get("MODEL_PROVIDER", "openrouter")
        if provider == "azure":
            azure_settings(config)
        elif provider == "openrouter":
            model = config.get("OPENROUTER_MODEL") or "nvidia/nemotron-3.5-super-vl:free"
            if not (config.get("OPENROUTER_API_KEY") or "").strip() or not model.endswith(":free"):
                raise ModelUnavailable()
        else:
            raise ModelUnavailable()
    except Exception:
        return JSONResponse(status_code=503, content={"error": {
            "code": "NOT_READY", "message": "Check catalog, local embeddings and provider configuration."}})
    return {"status": "ready", "provider": provider, "live_provider_checked": False, "retrieval_mode": get_mode()}

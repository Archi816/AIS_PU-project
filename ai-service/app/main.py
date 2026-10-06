"""HTTP entry point for the LEMS AI service."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas import AnalysisRequest, AnalysisResponse, ErrorResponse
from app.model_service import ModelUnavailable, analyze_with_model

app = FastAPI(
    title="LEMS AI Service",
    description="Equipment maintenance assistant API. Azure model configured via environment.",
    version="0.3.0",
)


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
    response_model=AnalysisResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid request"},
        503: {"model": ErrorResponse, "description": "Model unavailable or not configured"},
    },
)
def analyze(payload: AnalysisRequest):
    """Return validated model output or a safe error without provider details."""
    try:
        return analyze_with_model(payload)
    except ModelUnavailable:
        return JSONResponse(status_code=503, content={"error": {
            "code": "MODEL_UNAVAILABLE",
            "message": "Сервис модели временно недоступен. Проверьте настройки подключения или повторите запрос позже.",
        }})

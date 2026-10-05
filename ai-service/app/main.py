"""HTTP entry point for the LEMS AI service."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas import AnalysisRequest, AnalysisResponse, ErrorResponse

app = FastAPI(
    title="LEMS AI Service",
    description="Equipment maintenance assistant API. Model integration is not configured yet.",
    version="0.2.0",
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
def analyze(payload: AnalysisRequest) -> AnalysisResponse:
    """Validate a request. Successful response contracts are reserved for model integration."""
    return JSONResponse(status_code=503, content={"error": {
        "code": "MODEL_UNAVAILABLE",
        "message": "Сервис модели недоступен: подключение ещё не настроено.",
    }})

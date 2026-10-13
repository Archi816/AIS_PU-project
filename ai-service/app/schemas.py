"""Version 1 request, response, and error contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=4000)]


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)]
    equipment_id: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)]
    problem_description: Text


class DocumentationSource(BaseModel):
    url: str
    section: str
    verified_at: str


class ReportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: str
    result_type: Literal["report"] = "report"
    preliminary: Literal[True] = True
    symptoms: list[Text]
    possible_causes: list[Text]
    recommended_checks: list[Text]
    missing_information: list[Text]
    documentation_status: Literal["provided", "unavailable"]
    documentation_sources: list[DocumentationSource]


AnalysisResponse = ReportResponse

class ErrorDetail(BaseModel):
    code: Literal["MODEL_UNAVAILABLE", "VALIDATION_ERROR", "EQUIPMENT_NOT_FOUND", "CATALOG_UNAVAILABLE"]
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail

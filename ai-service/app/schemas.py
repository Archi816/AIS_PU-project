"""Version 1 request, response, and error contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=4000)]


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)]
    equipment_model: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)]
    problem_description: Text


class ClarificationResponse(BaseModel):
    ticket_id: str
    result_type: Literal["clarification"] = "clarification"
    questions: list[Text] = Field(min_length=1, max_length=10)


class ReportResponse(BaseModel):
    ticket_id: str
    result_type: Literal["report"] = "report"
    preliminary: Literal[True] = True
    symptoms: list[Text] = Field(min_length=1)
    possible_causes: list[Text]
    recommended_checks: list[Text]


AnalysisResponse = Annotated[
    ClarificationResponse | ReportResponse, Field(discriminator="result_type")
]


class ErrorDetail(BaseModel):
    code: Literal["MODEL_UNAVAILABLE", "VALIDATION_ERROR"]
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail

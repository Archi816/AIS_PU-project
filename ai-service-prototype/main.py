"""LEMS AI Component.

Receives a problem report + equipment info from the C# backend and returns
static, structured recommendations (NOT a chat). If ANTHROPIC_API_KEY is set the
Claude API is used; otherwise (or on any error) a built-in rule-based analyzer
produces the recommendations, so the service always works offline.
"""
import json
import os
from typing import List, Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="LEMS AI Component")


class EquipmentInfo(BaseModel):
    inventory_number: str = ""
    title: str = ""
    description: str = ""
    category: str = ""
    location: str = ""


class AnalyzeRequest(BaseModel):
    problem_title: str
    problem_description: str
    equipment: EquipmentInfo


class AnalyzeResponse(BaseModel):
    summary: str
    recommendations: List[str]
    source: str


RULES = [
    (("power", "turn on", "turns on", "won't start", "dead", "no light", "doesn't start", "not starting"),
     "Equipment does not power up",
     ["Check the power cable, socket and fuse/circuit breaker.",
      "Try a different known-good outlet or power cable.",
      "Inspect the internal fuse and the power switch for damage.",
      "If the PSU is faulty, replace it or send the unit to external service."]),
    (("overheat", "hot", "burning", "smoke", "smell", "temperature"),
     "Possible overheating or electrical fault",
     ["Switch the equipment off and unplug it immediately (safety first).",
      "Check fans and ventilation slots for dust or blockage.",
      "Inspect for burnt components/odor; do not use until inspected.",
      "Consider thermal paste/fan replacement or external service."]),
    (("calibrat", "inaccurate", "wrong reading", "drift", "offset", "unstable"),
     "Measurement accuracy / calibration issue",
     ["Run the calibration procedure with a certified reference.",
      "Check probes, cables and connectors for wear or loose contacts.",
      "Let the device warm up and recheck in a stable environment.",
      "If drift persists, schedule professional recalibration."]),
    (("leak", "water", "liquid", "drip"),
     "Liquid leakage",
     ["Disconnect power and isolate the unit.",
      "Locate the leak source (seals, tubing, fittings) and replace worn parts.",
      "Check for liquid ingress into electronics before reuse."]),
    (("display", "screen", "lcd", "blank", "flicker"),
     "Display problem",
     ["Check the display cable/connection and brightness settings.",
      "Power-cycle and reset to factory defaults.",
      "Test with an external monitor if supported; replace the display if needed."]),
    (("software", "error", "crash", "freeze", "frozen", "hang", "firmware", "driver", "usb", "connect"),
     "Software / connectivity issue",
     ["Restart the device and the host computer.",
      "Reinstall drivers or update the firmware to the latest version.",
      "Try another cable or port and check the error code in the manual."]),
    (("broken", "crack", "damaged", "loose", "stuck", "jam", "mechanical", "noise", "vibrat", "grind"),
     "Mechanical damage or wear",
     ["Inspect moving parts, lenses and housings for visible damage.",
      "Tighten loose fasteners and lubricate moving parts as per manual.",
      "Replace worn or cracked components; use external service if unavailable."]),
]


def rule_based(req: AnalyzeRequest) -> AnalyzeResponse:
    text = f"{req.problem_title} {req.problem_description}".lower()
    causes, recs = [], []
    for keys, cause, steps in RULES:
        if any(k in text for k in keys):
            causes.append(cause)
            for s in steps:
                if s not in recs:
                    recs.append(s)
    name = req.equipment.title or "the equipment"
    if not causes:
        causes.append("Cause not clear from the description")
        recs = ["Ask the reporter for exact symptoms, error messages and when the issue started.",
                "Inspect the equipment visually and run its self-test, if available.",
                "Consult the manufacturer's manual / troubleshooting guide."]
    recs.append("Verify the fix with a full functional test before returning it to AVAILABLE.")
    summary = f"Possible causes for {name}: " + "; ".join(causes) + "."
    return AnalyzeResponse(summary=summary, recommendations=recs, source="rule-based")


async def ask_claude(req: AnalyzeRequest, key: str) -> Optional[AnalyzeResponse]:
    prompt = (
        "You assist a laboratory administrator. Analyse this equipment problem report and answer "
        'ONLY with JSON: {"summary": "<1-2 sentences on likely causes>", '
        '"recommendations": ["<short actionable step>", ...]} with 3-6 steps.\n\n'
        f"Equipment: {req.equipment.title} (inv. {req.equipment.inventory_number}), "
        f"category: {req.equipment.category}, location: {req.equipment.location}.\n"
        f"Equipment description: {req.equipment.description}\n"
        f"Problem title: {req.problem_title}\nProblem description: {req.problem_description}"
    )
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"), "max_tokens": 700,
                  "messages": [{"role": "user", "content": prompt}]},
        )
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json()["content"]).strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    data = json.loads(text)
    recs = [str(x) for x in data["recommendations"]][:8]
    return AnalyzeResponse(summary=str(data["summary"]), recommendations=recs, source="claude")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    key = os.getenv("ANTHROPIC_API_KEY")
    if key:
        try:
            res = await ask_claude(req, key)
            if res and res.recommendations:
                return res
        except Exception:
            pass  # fall back to rules
    return rule_based(req)

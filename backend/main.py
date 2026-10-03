"""
backend/main.py

GuardRail Validator — FastAPI Entry Point
==========================================
Implements the Tiered Fast-Fail architecture:

  POST /api/validate
    │
    ├─ Tier 1: Deterministic Engine  (instant, zero-latency)
    │          rule_checker.py
    │          └─ If BLOCK → return immediately (fast-fail)
    │
    └─ Tier 2: AI Analysis Layer     (concurrent LLM + PII + Policy)
               orchestrator.py
               └─ Synthesize → final APPROVE / BLOCK decision

CORS is pre-configured to accept requests from the Vite frontend at
http://localhost:5173 (update FRONTEND_ORIGIN env var for production).
"""
from __future__ import annotations

import os
import math
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from deterministic_engine.canonical_schema import (
    ValidationRequest,
    ValidationResponse,
    PillarResult,
)
from deterministic_engine.rule_checker import run_deterministic_checks
from ai_analysis.orchestrator import run_ai_analysis

load_dotenv()

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="GuardRail Validator API",
    description=(
        "Agentic AI Circuit-Breaker — Tiered Fast-Fail architecture. "
        "Tier 1: deterministic rule engine. Tier 2: concurrent LLM + PII + RAG policy analysis."
    ),
    version="0.1.0",
)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper: compute final risk score
# ---------------------------------------------------------------------------

def _compute_risk_score(
    det_delta: int,
    ai_findings: dict | None,
    sensitivity: str,
    reversibility: str,
) -> int:
    base = det_delta  # 0–100 from deterministic violations

    if ai_findings:
        level = ai_findings.get("semantic_risk_level", "LOW")
        level_map = {"LOW": 10, "MEDIUM": 30, "HIGH": 60, "CRITICAL": 80}
        base += level_map.get(level, 0)
        if ai_findings.get("prompt_injection_detected"):
            base += 20
        if ai_findings.get("data_flow_violation"):
            base += 15
        base += len(ai_findings.get("violated_policies", [])) * 10

    # Sensitivity modifier
    sens_map = {
        "LOW": 0, "MEDIUM": 5, "HIGH": 10,
        "CRITICAL": 20, "PHI_CRITICAL": 25, "PII_CRITICAL": 25, "LIFE_CRITICAL": 30,
    }
    base += sens_map.get(sensitivity, 0)

    # Irreversibility modifier
    if reversibility == "IRREVERSIBLE":
        base += 15
    elif reversibility == "PARTIALLY_REVERSIBLE":
        base += 5

    return min(base, 100)


# ---------------------------------------------------------------------------
# Helper: build explanation string
# ---------------------------------------------------------------------------

def _build_explanation(
    final_decision: str,
    det_result: dict,
    ai_result: dict | None,
    schema_dict: dict,
) -> str:
    parts: list[str] = []

    if det_result["blocked"]:
        parts.append(f"[TIER-1 FAST-FAIL] {det_result['fast_fail_reason']}")

    if ai_result:
        findings = ai_result.get("findings", {})
        parts.append(f"[TIER-2 AI] {findings.get('reasoning', 'No LLM reasoning returned.')}")
        policies = findings.get("violated_policies", [])
        if policies:
            parts.append("Violated policies: " + "; ".join(policies))
        if findings.get("prompt_injection_detected"):
            parts.append("⚠ Prompt injection signature confirmed by LLM.")
        if findings.get("data_flow_violation"):
            parts.append("⚠ PII data-flow violation: sensitive data targeting untrusted destination.")

    if not parts:
        parts.append(
            "Action passed all deterministic and AI checks. "
            "Read-only on authorized scope with no sensitive data concerns."
        )

    verdict = "✅ APPROVED" if final_decision == "APPROVE" else "🚫 BLOCKED"
    return f"{verdict} — " + " | ".join(parts)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["System"])
async def health_check():
    return {
        "status": "online",
        "service": "GuardRail Validator API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post(
    "/api/validate",
    response_model=ValidationResponse,
    summary="Validate an agent action through the Guardrail pipeline",
    tags=["Validation"],
)
async def validate_action(request: ValidationRequest) -> ValidationResponse:
    """
    **Tiered Fast-Fail Pipeline**

    1. **Tier 1 – Deterministic Engine**: Instant rule-based checks.
       - If any hard rule is violated → immediate `BLOCK` is returned without
         calling the LLM (fast-fail, sub-millisecond).

    2. **Tier 2 – AI Analysis Layer** (only if Tier 1 passes):
       - `llm_analyzer` + `pii_analyzer` run **concurrently** via `asyncio.gather`.
       - `policy_matcher` (RAG) runs on the merged findings.
       - Pessimistic consensus: if *either* Tier flags high risk → **BLOCK**.
    """
    schema = request.canonical_schema
    schema_dict = schema.model_dump()

    # ── TIER 1: Deterministic Fast-Fail ──────────────────────────────────
    det_result = run_deterministic_checks(schema)

    if det_result["blocked"]:
        risk = _compute_risk_score(
            det_result["risk_score_delta"],
            None,
            schema.sensitivity,
            schema.reversibility,
        )
        explanation = _build_explanation("BLOCK", det_result, None, schema_dict)
        return ValidationResponse(
            final_decision="BLOCK",
            decision_path="DETERMINISTIC_FAST_FAIL",
            risk_score=risk,
            pillars=det_result["pillars"],
            deterministic_findings={
                "violation_count": det_result["violation_count"],
                "warning_count": det_result["warning_count"],
                "fast_fail_reason": det_result["fast_fail_reason"],
            },
            ai_findings=None,
            violated_policies=[],
            explanation=explanation,
        )

    # ── TIER 2: AI Analysis (only reached if Tier 1 passes) ──────────────
    ai_result: dict | None = None

    if not request.skip_ai_analysis:
        try:
            ai_result = await run_ai_analysis(schema_dict)
        except Exception as exc:
            # Fail-secure: if AI layer errors, default to BLOCK
            raise HTTPException(
                status_code=502,
                detail=f"AI analysis layer failed: {exc}. Defaulting to BLOCK for safety.",
            )

    # ── Pessimistic Consensus ─────────────────────────────────────────────
    ai_decision = ai_result["ai_decision"] if ai_result else "APPROVE"
    final_decision = "BLOCK" if (det_result["blocked"] or ai_decision == "BLOCK") else "APPROVE"
    decision_path = "DUAL_PATH" if ai_result else "DETERMINISTIC_ONLY"

    ai_findings = ai_result["findings"] if ai_result else None
    violated_policies = (ai_findings or {}).get("violated_policies", [])

    risk = _compute_risk_score(
        det_result["risk_score_delta"],
        ai_findings,
        schema.sensitivity,
        schema.reversibility,
    )

    explanation = _build_explanation(final_decision, det_result, ai_result, schema_dict)

    return ValidationResponse(
        final_decision=final_decision,
        decision_path=decision_path,
        risk_score=risk,
        pillars=det_result["pillars"],
        deterministic_findings={
            "violation_count": det_result["violation_count"],
            "warning_count": det_result["warning_count"],
        },
        ai_findings=ai_findings,
        violated_policies=violated_policies,
        explanation=explanation,
    )

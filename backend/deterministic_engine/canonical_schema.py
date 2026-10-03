"""
deterministic_engine/canonical_schema.py

Pydantic models for the Canonical Action Schema that all domain adapters
must produce before submitting an action to the Guardrail pipeline.
"""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field


class ContextBlock(BaseModel):
    """Metadata about where this action originated."""
    agent_id: str = Field(..., description="Unique identifier of the requesting agent")
    agent_name: str = Field(..., description="Human-readable agent name")
    domain: str = Field(..., description="Business domain (e.g. healthcare, aerospace)")
    session_id: Optional[str] = None


class DestinationBlock(BaseModel):
    """Describes the target system the action touches."""
    system: str = Field(..., description="Target system name")
    trust_level: str = Field(
        default="UNTRUSTED",
        description="Trust classification: TRUSTED | INTERNAL | UNTRUSTED"
    )
    endpoint: Optional[str] = None


class CanonicalSchema(BaseModel):
    """
    The standard intermediate representation produced by the Adapter Layer.
    Every domain-specific action is translated into this schema before
    entering the Guardrail Core.
    """
    intent: str = Field(..., description="High-level intent category, e.g. DATA_READ")
    action: str = Field(..., description="Specific action verb, e.g. QUERY, UPLOAD, DELETE")
    target: str = Field(..., description="Primary resource being acted upon")
    payload: Optional[Any] = Field(default=None, description="Data payload or parameters")
    reversibility: str = Field(
        ...,
        description="FULLY_REVERSIBLE | PARTIALLY_REVERSIBLE | REVERSIBLE_WITH_AUDIT | IRREVERSIBLE"
    )
    authorization_scope: str = Field(
        ...,
        description="Declared scope the agent believes it holds"
    )
    sensitivity: str = Field(
        ...,
        description="LOW | MEDIUM | HIGH | CRITICAL | PHI_CRITICAL | PII_CRITICAL | LIFE_CRITICAL"
    )
    context: Optional[ContextBlock] = None
    destination: Optional[DestinationBlock] = None
    raw_agent_instruction: Optional[str] = Field(
        default=None,
        description="The original unmodified instruction from the agent (for injection scanning)"
    )


class ValidationRequest(BaseModel):
    """Top-level request body for POST /api/validate."""
    canonical_schema: CanonicalSchema
    skip_ai_analysis: bool = Field(
        default=False,
        description="If True, only run deterministic checks (faster, for testing)"
    )


class PillarResult(BaseModel):
    name: str
    status: str          # pass | fail | warn
    detail: str


class ValidationResponse(BaseModel):
    """Complete response from the Guardrail Validator."""
    final_decision: str           # APPROVE | BLOCK
    decision_path: str            # DETERMINISTIC_FAST_FAIL | AI_ANALYSIS | DUAL_PATH
    risk_score: int               # 0–100
    pillars: list[PillarResult]
    deterministic_findings: dict[str, Any]
    ai_findings: Optional[dict[str, Any]] = None
    violated_policies: list[str] = []
    explanation: str

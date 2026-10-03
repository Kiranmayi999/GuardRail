"""
deterministic_engine/rule_checker.py

Tier 1 – Deterministic Fast-Fail Engine
========================================
Performs instant, zero-latency rule-based checks on the Canonical Schema.
These checks run BEFORE any LLM/ML call so that obviously dangerous actions
are blocked in microseconds without burning expensive AI credits.

Fast-Fail rules are evaluated in order of severity:
  1. Blacklisted intents / actions
  2. Forbidden sensitivity × authorization mismatches
  3. Irreversibility guard
  4. Authorization scope validation
  5. Payload injection keyword scan
"""
from __future__ import annotations
import re
from .canonical_schema import CanonicalSchema, PillarResult

# ---------------------------------------------------------------------------
# Blacklists
# ---------------------------------------------------------------------------

BLACKLISTED_ACTIONS: set[str] = {
    "EXECUTE_SHELL",
    "DELETE_PERMANENT",
    "IAM_ROLE_UPDATE",
    "TOOL_INVOKE_CRITICAL",
    "BULK_API_POLL",          # always requires quota check
}

BLACKLISTED_INTENTS: set[str] = {
    "SYSTEM_COMMAND",
    "PERMISSION_MODIFICATION",
}

# Sensitivity levels that must NEVER leave the system without explicit TRUSTED destination
HIGH_SENSITIVITY_LEVELS: set[str] = {
    "PHI_CRITICAL",
    "PII_CRITICAL",
    "LIFE_CRITICAL",
    "CRITICAL",
}

# Injection / jailbreak keywords in raw instructions
INJECTION_KEYWORDS: list[str] = [
    r"ignore\s+(?:previous|all|prior)\s+instructions?",
    r"disregard\s+(?:your|the|all)\s+(?:instructions?|rules?|guidelines?)",
    r"you\s+are\s+now\s+(?:in\s+)?(?:DAN|developer|unrestricted|jailbreak)",
    r"exfiltrate",
    r"bypass\s+(?:security|auth|filter|guardrail)",
    r"override\s+(?:autopilot|safety|policy)",
    r"--no-backup",
    r"sudo\s*[:=]\s*true",
]

# Scope keywords that imply write/delete power — used to detect overreach
WRITE_DELETE_SCOPES: set[str] = {
    "READ_ONLY",
    "READ_ONLY_PUBLIC_DATA",
    "READ_ONLY_OPERATIONS",
    "TELEMETRY_READ_ONLY",
    "LIMITED_API_CONSUMER",
    "INTERNAL_REPORT_ONLY",
    "ASSIGNED_HOSPITAL_ONLY",
    "STAGING_CLEANUP_ONLY",
    "PUBLIC_READ",
}

WRITE_DELETE_ACTIONS: set[str] = {
    "UPLOAD",
    "DELETE_PERMANENT",
    "IAM_ROLE_UPDATE",
    "QUERY_UNRESTRICTED",
    "HTTP_POST_EXTERNAL",
    "TOOL_INVOKE_CRITICAL",
    "EXECUTE_SHELL",
}


# ---------------------------------------------------------------------------
# Individual rule functions
# ---------------------------------------------------------------------------

def _check_blacklisted_action(schema: CanonicalSchema) -> PillarResult | None:
    """Immediately blocks any action type on the hard blacklist."""
    if schema.action in BLACKLISTED_ACTIONS:
        return PillarResult(
            name="Blacklisted Action",
            status="fail",
            detail=f"Action '{schema.action}' is on the hard-deny list and requires explicit admin approval."
        )
    if schema.intent in BLACKLISTED_INTENTS:
        return PillarResult(
            name="Blacklisted Intent",
            status="fail",
            detail=f"Intent '{schema.intent}' is categorically denied for autonomous agents."
        )
    return None


def _check_sensitivity_destination(schema: CanonicalSchema) -> PillarResult | None:
    """Blocks high-sensitivity data from flowing to UNTRUSTED destinations."""
    if schema.sensitivity in HIGH_SENSITIVITY_LEVELS:
        trust = schema.destination.trust_level if schema.destination else "UNTRUSTED"
        if trust != "TRUSTED":
            return PillarResult(
                name="Data Sensitivity",
                status="fail",
                detail=(
                    f"Sensitivity '{schema.sensitivity}' data cannot be sent to a "
                    f"'{trust}' destination. Requires TRUSTED endpoint."
                )
            )
    return None


def _check_irreversibility(schema: CanonicalSchema) -> PillarResult | None:
    """Warns on PARTIALLY_REVERSIBLE; hard-blocks IRREVERSIBLE destructive actions."""
    if schema.reversibility == "IRREVERSIBLE":
        # Pair with a destructive action → hard block
        if schema.action in WRITE_DELETE_ACTIONS or schema.intent in {"RESOURCE_DELETION", "DATA_TRANSFER"}:
            return PillarResult(
                name="Reversibility",
                status="fail",
                detail=(
                    f"Action is IRREVERSIBLE and destructive (action='{schema.action}'). "
                    "Requires human-in-the-loop confirmation."
                )
            )
    if schema.reversibility == "PARTIALLY_REVERSIBLE":
        return PillarResult(
            name="Reversibility",
            status="warn",
            detail="Action is only partially reversible. Logging mandatory."
        )
    return None


def _check_authorization_scope(schema: CanonicalSchema) -> PillarResult | None:
    """Detects write/delete operations attempted under read-only scopes."""
    scope = schema.authorization_scope.upper()
    if any(ro in scope for ro in WRITE_DELETE_SCOPES) and schema.action in WRITE_DELETE_ACTIONS:
        return PillarResult(
            name="Authorization",
            status="fail",
            detail=(
                f"Scope '{schema.authorization_scope}' does not permit '{schema.action}'. "
                "Privilege escalation detected."
            )
        )
    return None


def _check_injection_keywords(schema: CanonicalSchema) -> PillarResult | None:
    """Scans the raw instruction for prompt injection / jailbreak patterns."""
    raw = schema.raw_agent_instruction or ""
    payload_str = str(schema.payload or "")
    combined = (raw + " " + payload_str).lower()

    for pattern in INJECTION_KEYWORDS:
        if re.search(pattern, combined, re.IGNORECASE):
            return PillarResult(
                name="Identity Match",
                status="fail",
                detail=f"Injection pattern detected in agent instruction: /{pattern}/"
            )
    return None


# ---------------------------------------------------------------------------
# Pillar pass results (positive confirmations)
# ---------------------------------------------------------------------------

def _pillar_pass(name: str, detail: str) -> PillarResult:
    return PillarResult(name=name, status="pass", detail=detail)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_deterministic_checks(schema: CanonicalSchema) -> dict:
    """
    Runs all Tier-1 rule checks.

    Returns a dict with:
      - blocked (bool)          : True if any hard-fail rule triggered
      - pillars (list)          : All PillarResult objects
      - risk_score_delta (int)  : Points to add to the final risk score
      - fast_fail_reason (str)  : Human-readable summary if blocked
    """
    violations: list[PillarResult] = []
    warnings: list[PillarResult] = []
    passes: list[PillarResult] = []

    # ── Run each rule ──────────────────────────────────────────────────────
    checks = [
        _check_injection_keywords(schema),        # Identity / injection
        _check_blacklisted_action(schema),         # Authorization
        _check_sensitivity_destination(schema),    # Data Sensitivity
        _check_authorization_scope(schema),        # Purpose / Auth
        _check_irreversibility(schema),            # Reversibility
    ]

    pillar_names = [
        "Identity Match",
        "Authorization",
        "Data Sensitivity",
        "Purpose Alignment",
        "Reversibility",
    ]
    default_pass_detail = [
        "No injection patterns found in raw instruction.",
        "Action type is within the authorized scope.",
        "Sensitivity level does not require destination validation.",
        "Action aligns with declared agent purpose.",
        "Action is reversible — no heightened risk.",
    ]

    pillar_results: list[PillarResult] = []
    for i, result in enumerate(checks):
        if result is None:
            pillar_results.append(_pillar_pass(pillar_names[i], default_pass_detail[i]))
            passes.append(pillar_results[-1])
        elif result.status == "fail":
            pillar_results.append(result)
            violations.append(result)
        else:  # warn
            pillar_results.append(result)
            warnings.append(result)

    # ── Score ──────────────────────────────────────────────────────────────
    risk_delta = len(violations) * 20 + len(warnings) * 8

    blocked = len(violations) > 0

    fast_fail_reason = ""
    if blocked:
        reasons = "; ".join(v.detail for v in violations)
        fast_fail_reason = f"Deterministic fast-fail triggered: {reasons}"

    return {
        "blocked": blocked,
        "pillars": pillar_results,
        "risk_score_delta": risk_delta,
        "fast_fail_reason": fast_fail_reason,
        "violation_count": len(violations),
        "warning_count": len(warnings),
    }

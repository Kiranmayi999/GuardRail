import asyncio
from .llm_analyzer import analyze_intent_and_risk
from .pii_analyzer import analyze_data_and_pii
from .policy_matcher import match_semantic_policy

async def run_ai_analysis(canonical_schema: dict) -> dict:
    """Runs deep analysis nodes concurrently and synthesizes findings."""
    
    # 1. Run LLM and PII checks in parallel to save time
    llm_results, pii_results = await asyncio.gather(
        analyze_intent_and_risk(canonical_schema),
        analyze_data_and_pii(canonical_schema)
    )
    
    # 2. Merge initial findings
    synthesized_findings = {**llm_results, **pii_results}
    
    # 3. Run Policy Matcher based on the findings
    matched_policies = await match_semantic_policy(canonical_schema, synthesized_findings)
    synthesized_findings["violated_policies"] = matched_policies
    
    # 4. Final AI Decision Logic
    ai_decision = "APPROVE"
    if (synthesized_findings.get("prompt_injection_detected") or 
        synthesized_findings.get("data_flow_violation") or 
        synthesized_findings.get("semantic_risk_level") in ["HIGH", "CRITICAL"] or
        len(matched_policies) > 0):
        ai_decision = "BLOCK"
        
    return {
        "ai_decision": ai_decision,
        "findings": synthesized_findings
    }

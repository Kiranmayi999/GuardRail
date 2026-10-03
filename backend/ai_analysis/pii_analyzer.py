import re

async def analyze_data_and_pii(canonical_schema: dict) -> dict:
    """Identifies sensitive data and checks data-flow constraints."""
    
    payload = str(canonical_schema.get("payload", "")).lower()
    
    # Simple regex/keyword matching for PII
    sensitive_patterns = [r"\b\d{9}\b", r"medical", r"password", r"credential", r"ssn"]
    
    contains_pii = False
    for pattern in sensitive_patterns:
        if re.search(pattern, payload):
            contains_pii = True
            break
            
    # Check data flow (e.g., stopping PII from going to untrusted external systems)
    destination_trust = canonical_schema.get("destination", {}).get("trust_level", "UNTRUSTED")
    
    data_flow_violation = False
    if contains_pii and destination_trust != "TRUSTED":
        data_flow_violation = True

    return {
        "sensitive_data_detected": contains_pii,
        "data_flow_violation": data_flow_violation
    }

import urllib.request, json, sys

payload = {
    "canonical_schema": {
        "intent": "DATA_READ",
        "action": "QUERY",
        "target": "PUBLIC_DATABASE",
        "payload": "medicine_expenditure_statistics",
        "reversibility": "FULLY_REVERSIBLE",
        "authorization_scope": "PUBLIC_READ",
        "sensitivity": "LOW",
        "context": {"agent_id": "agent-gov-001", "agent_name": "Gov Research Agent", "domain": "government"},
    },
    "skip_ai_analysis": True
}
data = json.dumps(payload).encode()
req = urllib.request.Request(
    "http://localhost:8000/api/validate",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST"
)
resp = urllib.request.urlopen(req).read().decode()
result = json.loads(resp)
out = "\n".join([
    "Decision : " + result["final_decision"],
    "Path     : " + result["decision_path"],
    "Risk     : " + str(result["risk_score"]) + "/100",
    "Pillars  : " + str([(p["name"], p["status"]) for p in result["pillars"]]),
])
sys.stdout.buffer.write(out.encode("utf-8"))

# 🛡️ GuardRail — Agentic AI Guardrail Validator
> **Infosys Hack-AI-Thon 2026** · Prototype v0.1.0

A **domain-agnostic circuit-breaker** that intercepts an autonomous AI agent's planned actions, evaluates them for safety, authorization, explainability, and reversibility, and decides whether to **APPROVE** or **BLOCK** the action.

---

## Architecture

```
Any Domain Agent (Healthcare / Aerospace / Finance…)
        │
        ▼
  [ Adapter Layer ]          ← Translates domain-specific action into
        │                       a standard Canonical Schema (JSON)
        ▼
  [ Guardrail Core ]
   ┌────────────────────────────────────┐
   │  TIER 1 · Deterministic Engine     │  ← Zero-latency rule checks
   │  rule_checker.py                   │    (injection, blacklist, scope,
   │                                    │     sensitivity, reversibility)
   │  ↓ Fast-fail if blocked            │
   │  TIER 2 · AI Analysis Layer        │  ← Concurrent LLM + PII + RAG
   │  ┌──────────┬──────────┬────────┐  │
   │  │llm_      │pii_      │policy_ │  │
   │  │analyzer  │analyzer  │matcher │  │
   │  └──────────┴──────────┴────────┘  │
   │       asyncio.gather()             │
   └────────────────────────────────────┘
        │
        ▼
  [ Decision Engine ]        ← Pessimistic Consensus:
        │                       if EITHER tier flags risk → BLOCK
        ▼
   APPROVE ✅  or  BLOCK 🚫
```

---

## Project Structure

```
GuardRail/
├── frontend/                  # React + Vite + Tailwind UI dashboard
│   └── src/
│       ├── App.tsx            # 3-column dashboard, live API integration
│       ├── api.ts             # Fetch client → backend /api/validate
│       ├── scenarios.ts       # Mock data for all 8 attack vectors
│       └── index.css          # Dark cyber-terminal theme
│
└── backend/                   # FastAPI Tiered Fast-Fail engine
    ├── main.py                # App entry: POST /api/validate, GET /health
    ├── requirements.txt
    ├── .env.example           # Copy to .env and add your API key
    ├── deterministic_engine/
    │   ├── canonical_schema.py  # Pydantic models (request / response)
    │   └── rule_checker.py      # Tier-1: 5 instant rule checks
    └── ai_analysis/
        ├── orchestrator.py      # asyncio.gather() coordinator
        ├── llm_analyzer.py      # Intent + injection + semantic risk (Qualcomm LLM)
        ├── pii_analyzer.py      # Regex PII scan + data-flow check
        └── policy_matcher.py    # RAG policy retrieval (mocked → Redis-ready)
```

---

## Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **Python** ≥ 3.11

---

### 1 · Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# Install dependencies
pip install -r requirements.txt

# Configure API key (optional — deterministic engine works without it)
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
# Edit .env → fill in QUALCOMM_API_KEY and QUALCOMM_BASE_URL

# Start the server (port 8000, hot-reload)
uvicorn main:app --reload --port 8000
```

Backend is live at: **http://localhost:8000**
Interactive API docs: **http://localhost:8000/docs**

---

### 2 · Frontend

```bash
cd frontend

npm install      # first time only
npx vite         # starts on http://localhost:5173
```

---

### 3 · Open the Demo

Visit **http://localhost:5173** — the header shows a live **BACKEND LIVE** / **BACKEND OFFLINE** badge.

- **Backend LIVE** → Every button click sends a real `POST /api/validate` request. Results show `⚡ LIVE API` tag.
- **Backend OFFLINE** → UI falls back to local mock data automatically. Shows `📦 MOCK DATA` tag.

---

## API Reference

### `GET /health`
```json
{ "status": "online", "service": "GuardRail Validator API", "timestamp": "…" }
```

### `POST /api/validate`

**Request body:**
```json
{
  "canonical_schema": {
    "intent": "FILE_TRANSFER",
    "action": "UPLOAD",
    "target": "INTERNAL_SERVER",
    "payload": "external_file.zip",
    "reversibility": "PARTIALLY_REVERSIBLE",
    "authorization_scope": "READ_ONLY_PUBLIC_DATA",
    "sensitivity": "HIGH",
    "destination": { "system": "internal_server", "trust_level": "UNTRUSTED" },
    "context": { "agent_id": "agent-001", "agent_name": "Research Agent", "domain": "government" },
    "raw_agent_instruction": "UPLOAD external_file.zip to internal_server"
  },
  "skip_ai_analysis": true
}
```

**Response:**
```json
{
  "final_decision": "BLOCK",
  "decision_path": "DETERMINISTIC_FAST_FAIL",
  "risk_score": 43,
  "pillars": [
    { "name": "Authorization", "status": "fail", "detail": "Scope 'READ_ONLY_PUBLIC_DATA' does not permit 'UPLOAD'." },
    { "name": "Reversibility",  "status": "warn", "detail": "Action is only partially reversible." }
  ],
  "violated_policies": [],
  "explanation": "🚫 BLOCKED — [TIER-1 FAST-FAIL] …"
}
```

---

## Attack Vector Scenarios

| # | Scenario | Decision | Risk | Trigger |
|---|---|---|---|---|
| 1 | Prompt Injection | 🚫 BLOCK | 99 | Injection keyword + blacklisted action |
| 2 | **Safe Search Query** | ✅ APPROVE | 12 | All pillars pass |
| 3 | Unauthorized Data Access | 🚫 BLOCK | 88 | PHI + scope violation |
| 4 | Privilege Escalation | 🚫 BLOCK | 97 | IAM write + blacklisted intent |
| 5 | Sensitive Data Exfiltration | 🚫 BLOCK | 96 | PII to untrusted external endpoint |
| 6 | **Unauthorized File Upload** | 🚫 BLOCK | 95 | Write under read-only scope |
| 7 | Dangerous Tool Call | 🚫 BLOCK | 100 | Life-critical + irreversible |
| 8 | Irreversible Action | 🚫 BLOCK | 98 | Production delete + no backup |
| 9 | Excessive API Calls | 🚫 BLOCK | 74 | DoS pattern — 50k unthrottled |

---

## Enabling the Qualcomm LLM (Tier-2 AI Analysis)

1. Add your credentials to `backend/.env`:
   ```
   QUALCOMM_API_KEY=your_key_here
   QUALCOMM_BASE_URL=https://api.qualcomm.com/v1
   ```
2. In the frontend `api.ts`, change `validateAction(schema, true)` → `validateAction(schema, false)` to enable full dual-path evaluation.
3. The orchestrator will then run `llm_analyzer + pii_analyzer` concurrently and synthesize a richer AI decision on top of the deterministic result.

---

## Team

**Infosys Hack-AI-Thon 2026** · GuardRail Team

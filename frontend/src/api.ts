/**
 * api.ts — GuardRail Frontend ↔ Backend Bridge
 *
 * Sends each scenario's canonical schema to the FastAPI backend at
 * http://localhost:8000/api/validate and returns a typed response.
 *
 * Falls back to null on network error so the UI can degrade gracefully
 * to the local mock data already in scenarios.ts.
 */

export interface ApiPillar {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface ApiResponse {
  final_decision: 'APPROVE' | 'BLOCK';
  decision_path: string;
  risk_score: number;
  pillars: ApiPillar[];
  deterministic_findings: Record<string, unknown>;
  ai_findings: Record<string, unknown> | null;
  violated_policies: string[];
  explanation: string;
}

const BACKEND = 'http://localhost:8000';

export type BackendStatus = 'checking' | 'online' | 'offline';

/** Quick probe — resolves to 'online' | 'offline' */
export async function checkBackendHealth(): Promise<BackendStatus> {
  try {
    const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

/**
 * Posts a canonical schema to the backend and returns the validation result.
 * skipAI=true uses only the deterministic engine (no Qualcomm LLM key needed).
 */
export async function validateAction(
  canonicalSchema: object,
  skipAI = true
): Promise<ApiResponse | null> {
  try {
    const res = await fetch(`${BACKEND}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_schema: canonicalSchema, skip_ai_analysis: skipAI }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`GuardRail API error: ${res.status}`, await res.text());
      return null;
    }

    return (await res.json()) as ApiResponse;
  } catch (err) {
    console.error('GuardRail API unreachable:', err);
    return null;
  }
}

import { useState, useEffect, useRef } from 'react';
import { scenarios, type Scenario, type Decision } from './scenarios';
import {
  validateAction,
  checkBackendHealth,
  type ApiResponse,
  type ApiPillar,
  type BackendStatus,
} from './api';

// ────────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────────

function PillarIcon({ status }: { status: string }) {
  if (status === 'pass') return <span className="text-emerald-400 text-lg">✓</span>;
  if (status === 'fail') return <span className="text-red-500 text-lg">✗</span>;
  if (status === 'warn') return <span className="text-amber-400 text-lg">⚠</span>;
  return <span className="text-slate-500 text-lg">○</span>;
}

function RiskDial({ score, animated }: { score: number; animated: boolean }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const [displayScore, setDisplayScore] = useState(0);
  const [dashOffset, setDashOffset] = useState(circ);

  useEffect(() => {
    if (!animated) { setDisplayScore(0); setDashOffset(circ); return; }
    const duration = 1200;
    const startTime = performance.now();
    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * score);
      setDisplayScore(current);
      setDashOffset(circ * (1 - (eased * score) / 100));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [score, animated, circ]);

  const color = score >= 80 ? '#ef4444' : score >= 50 ? '#f59e0b' : '#34d399';
  const textColor = score >= 80 ? 'text-red-400' : score >= 50 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={radius} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle cx="65" cy="65" r={radius} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 65 65)"
          style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'none' }}
        />
        <text x="65" y="58" textAnchor="middle" fill={color} fontSize="24" fontWeight="bold" fontFamily="monospace">{displayScore}</text>
        <text x="65" y="76" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="monospace">/ 100</text>
        <text x="65" y="90" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">RISK SCORE</text>
      </svg>
      <div className={`text-xs font-mono ${textColor}`}>
        {score >= 80 ? '🔴 CRITICAL' : score >= 50 ? '🟡 ELEVATED' : '🟢 SAFE'}
      </div>
    </div>
  );
}

function DecisionBanner({ decision, loading }: { decision: Decision; loading?: boolean }) {
  if (loading) {
    return (
      <div className="border border-cyan-800/50 bg-slate-900 rounded-lg p-5 flex flex-col items-center gap-2">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-2 h-2 rounded-full bg-cyan-500"
              style={{ animation: `bounce 0.8s ease-in-out ${i * 0.15}s infinite alternate` }} />
          ))}
        </div>
        <div className="text-cyan-500 font-mono text-xs tracking-widest animate-pulse">EVALUATING…</div>
      </div>
    );
  }

  if (decision === 'IDLE') {
    return (
      <div className="border border-slate-700 bg-slate-800/50 rounded-lg p-5 flex flex-col items-center gap-2">
        <div className="text-slate-500 text-4xl">○</div>
        <div className="text-slate-500 font-mono text-sm tracking-widest">AWAITING INPUT</div>
      </div>
    );
  }

  if (decision === 'APPROVE') {
    return (
      <div className="border border-emerald-500/60 bg-emerald-950/30 rounded-lg p-5 flex flex-col items-center gap-2 glow-green pulse-green">
        <div className="text-6xl">✅</div>
        <div className="text-emerald-400 font-mono text-2xl font-bold tracking-widest">APPROVED</div>
        <div className="text-emerald-600 text-xs font-mono">CIRCUIT BREAKER: OPEN — ACTION PERMITTED</div>
      </div>
    );
  }

  return (
    <div className="border border-red-500/60 bg-red-950/30 rounded-lg p-5 flex flex-col items-center gap-2 glow-red pulse-red">
      <div className="text-6xl">🚫</div>
      <div className="text-red-400 font-mono text-2xl font-bold tracking-widest">BLOCKED</div>
      <div className="text-red-700 text-xs font-mono">CIRCUIT BREAKER: TRIPPED — ACTION HALTED</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex flex-col items-center my-1">
      <div className="w-px h-3 bg-cyan-700" />
      <div className="flow-arrow text-cyan-500 text-sm">▼</div>
      <div className="w-px h-3 bg-cyan-700" />
    </div>
  );
}

/** Status pill shown in the header */
function BackendBadge({ status }: { status: BackendStatus }) {
  const cfg = {
    checking: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', label: 'CONNECTING…' },
    online:   { dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-400', label: 'BACKEND LIVE' },
    offline:  { dot: 'bg-slate-600', text: 'text-slate-500', label: 'BACKEND OFFLINE (MOCK)' },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      <span className={`${cfg.text} font-mono text-xs`}>{cfg.label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Display types — merge mock + real API response
// ────────────────────────────────────────────────────────────────────────────────

interface DisplayState {
  pillars: ApiPillar[];
  riskScore: number;
  decision: Decision;
  explanation: string;
  decisionPath: string;
  violatedPolicies: string[];
  llmVerdict: string;
  mlVerdict: string;
  source: 'live' | 'mock';
}

function scenarioToDisplay(s: Scenario): DisplayState {
  return {
    pillars: s.pillars.map(p => ({ name: p.name, status: p.status as 'pass' | 'fail' | 'warn', detail: p.detail })),
    riskScore: s.riskScore,
    decision: s.decision,
    explanation: s.explanation,
    decisionPath: 'MOCK_DATA',
    violatedPolicies: [],
    llmVerdict: s.llmVerdict,
    mlVerdict: s.mlVerdict,
    source: 'mock',
  };
}

function apiToDisplay(api: ApiResponse, _s: Scenario): DisplayState {
  const findings = api.ai_findings ?? {};
  return {
    pillars: api.pillars,
    riskScore: api.risk_score,
    decision: api.final_decision as Decision,
    explanation: api.explanation,
    decisionPath: api.decision_path,
    violatedPolicies: api.violated_policies,
    llmVerdict: findings['reasoning'] as string
      ?? (api.final_decision === 'BLOCK' ? 'BLOCK — Flagged by deterministic engine.' : 'APPROVE — No semantic risk detected.'),
    mlVerdict: `Risk score: ${api.risk_score}/100 · Path: ${api.decision_path}`,
    source: 'live',
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Main App
// ────────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [loading, setLoading] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const logRef = useRef<HTMLDivElement>(null);

  // Probe backend on mount and every 15 s
  useEffect(() => {
    const probe = () => checkBackendHealth().then(setBackendStatus);
    probe();
    const id = setInterval(probe, 15_000);
    return () => clearInterval(id);
  }, []);

  function startTypewriter(text: string) {
    setTypedText('');
    setTyping(true);
    let i = 0;
    function type() {
      if (i <= text.length) {
        setTypedText(text.slice(0, i));
        i++;
        setTimeout(type, 11);
      } else {
        setTyping(false);
      }
    }
    type();
  }

  async function selectScenario(s: Scenario) {
    // Reset panel
    setActiveScenario(s);
    setDisplay(null);
    setTypedText('');
    setLoading(true);
    setAnimKey(k => k + 1);

    if (backendStatus === 'online') {
      // ── LIVE path: call the real backend ──────────────────────────
      const apiResult = await validateAction(s.canonicalSchema, false); // false = run full LLM Tier-2
      setLoading(false);

      if (apiResult) {
        const d = apiToDisplay(apiResult, s);
        setDisplay(d);
        startTypewriter(d.explanation);
      } else {
        // API call failed mid-session — fall back to mock
        setBackendStatus('offline');
        const d = scenarioToDisplay(s);
        setDisplay(d);
        startTypewriter(d.explanation);
      }
    } else {
      // ── MOCK path: instant response from scenarios.ts ─────────────
      await new Promise(r => setTimeout(r, 280)); // brief visual delay
      setLoading(false);
      const d = scenarioToDisplay(s);
      setDisplay(d);
      startTypewriter(d.explanation);
    }
  }

  const schema = activeScenario
    ? JSON.stringify(activeScenario.canonicalSchema, null, 2)
    : null;

  const currentDecision: Decision = loading ? 'IDLE' : (display?.decision ?? 'IDLE');

  return (
    <div className="min-h-screen bg-slate-950 scanline flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-slate-800 px-6 py-3 flex items-center justify-between bg-slate-950/90 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 text-lg">🛡️</div>
          <div>
            <div className="font-mono font-bold text-cyan-400 text-sm tracking-widest">GUARDRAIL</div>
            <div className="font-mono text-slate-500 text-xs">Agentic AI Guardrail Validator · v0.1.0-prototype</div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <BackendBadge status={backendStatus} />
          <div className="text-slate-600">|</div>
          <div className="text-slate-400">DUAL-PATH ENGINE</div>
          <div className="text-slate-600">|</div>
          <div className="text-slate-400">PESSIMISTIC CONSENSUS</div>
        </div>
      </header>

      {/* ── Architecture breadcrumb ── */}
      <div className="px-6 py-2 border-b border-slate-800/50 bg-slate-950 flex gap-3 text-[10px] font-mono text-slate-600 flex-wrap">
        {['Domain Agent', '→', 'Adapter Layer', '→', 'Canonical Schema', '→', 'LLM Guardrail + ML Risk Model', '→', 'Decision Engine', '→', 'APPROVE / BLOCK'].map((t, i) => (
          <span key={i} className={t === '→' ? 'text-slate-700' : 'text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800'}>
            {t}
          </span>
        ))}
      </div>

      {/* ── 3-Column Layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═══════════ COLUMN 1: Attack Vectors ═══════════ */}
        <aside className="w-60 min-w-60 border-r border-slate-800 flex flex-col bg-slate-950">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="text-xs font-mono text-slate-500 tracking-widest uppercase">Attack Vectors</div>
            <div className="text-[10px] font-mono text-slate-700 mt-0.5">Simulated agent actions</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {scenarios.map((s) => (
              <button
                key={s.id}
                onClick={() => selectScenario(s)}
                disabled={loading}
                className={`attack-btn w-full text-left px-3 py-2.5 rounded text-xs font-mono flex items-center gap-2
                  ${activeScenario?.id === s.id
                    ? 'active text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-base">{s.icon}</span>
                <span className="leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-slate-800 text-[10px] font-mono text-slate-700">
            Infosys Hack-AI-Thon · 2026
          </div>
        </aside>

        {/* ═══════════ COLUMN 2: Agent Feed & Adapter ═══════════ */}
        <main className="flex-1 min-w-0 flex flex-col border-r border-slate-800 overflow-y-auto">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <div className="text-xs font-mono text-slate-400 tracking-widest uppercase">Agent Feed · Interceptor</div>
            </div>
            {display && (
              <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                display.source === 'live'
                  ? 'text-emerald-500 border-emerald-900 bg-emerald-950/30'
                  : 'text-slate-600 border-slate-800 bg-slate-900'
              }`}>
                {display.source === 'live' ? '⚡ LIVE API' : '📦 MOCK DATA'}
              </div>
            )}
          </div>

          {!activeScenario ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-700 font-mono text-sm gap-3 p-8">
              <div className="text-4xl opacity-30">🛡️</div>
              <div className="text-center">
                <div className="text-slate-600">Circuit breaker standing by.</div>
                <div className="text-slate-700 text-xs mt-1">Select an attack vector to intercept.</div>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4 slide-in" key={animKey}>

              {/* Agent Identity */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-2">Agent Identity</div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-cyan-900/30 border border-cyan-800/50 flex items-center justify-center text-xl flex-shrink-0">
                    {activeScenario.icon}
                  </div>
                  <div>
                    <div className="font-mono text-cyan-300 text-sm font-bold">{activeScenario.agentName}</div>
                    <div className="font-mono text-slate-500 text-xs">{activeScenario.agentDomain}</div>
                  </div>
                </div>
              </div>

              {/* Intercepted Action */}
              <div className="bg-slate-900 border border-amber-800/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <div className="text-[10px] font-mono text-amber-600 tracking-widest uppercase">⚡ Intercepted Action</div>
                </div>
                <div className="font-mono text-sm text-amber-300 bg-slate-950 rounded p-3 border border-amber-900/30 break-all">
                  {activeScenario.proposedAction}
                </div>
              </div>

              <FlowArrow />

              {/* Adapter Layer → Canonical Schema */}
              <div className="bg-slate-900 border border-cyan-800/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <div className="text-[10px] font-mono text-cyan-600 tracking-widest uppercase">Adapter Layer → Canonical Schema</div>
                </div>
                <pre className="font-mono text-xs text-cyan-300 bg-slate-950 rounded p-3 overflow-auto border border-cyan-900/30 max-h-64">
                  <span className="text-slate-600">{'// Standard Guardrail Schema v1.0\n'}</span>
                  {schema}
                </pre>
              </div>

              <FlowArrow />

              {/* Dual-Path Engine */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900 border border-violet-800/40 rounded-lg p-4">
                  <div className="text-[10px] font-mono text-violet-500 tracking-widest uppercase mb-2">🧠 LLM Guardrail</div>
                  <div className="font-mono text-xs text-slate-300 leading-relaxed">
                    {loading ? <span className="text-slate-600 animate-pulse">Evaluating…</span> : (display?.llmVerdict ?? activeScenario.llmVerdict)}
                  </div>
                </div>
                <div className="bg-slate-900 border border-blue-800/40 rounded-lg p-4">
                  <div className="text-[10px] font-mono text-blue-400 tracking-widest uppercase mb-2">📊 ML Risk Model</div>
                  <div className="font-mono text-xs text-slate-300 leading-relaxed">
                    {loading ? <span className="text-slate-600 animate-pulse">Evaluating…</span> : (display?.mlVerdict ?? activeScenario.mlVerdict)}
                  </div>
                </div>
              </div>

              {/* Violated Policies (live only) */}
              {display?.violatedPolicies && display.violatedPolicies.length > 0 && (
                <>
                  <FlowArrow />
                  <div className="bg-slate-900 border border-red-900/40 rounded-lg p-4">
                    <div className="text-[10px] font-mono text-red-600 tracking-widest uppercase mb-2">🗂️ Violated Policies (RAG Match)</div>
                    <div className="space-y-1">
                      {display.violatedPolicies.map((p, i) => (
                        <div key={i} className="font-mono text-xs text-red-400 flex gap-2">
                          <span className="text-red-700">▸</span>{p}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <FlowArrow />

              {/* Decision path label */}
              <div className="text-center">
                <span className="text-[10px] font-mono text-slate-600 tracking-widest uppercase">
                  Decision Engine · {display?.decisionPath ?? 'Pessimistic Consensus'}
                </span>
              </div>
            </div>
          )}
        </main>

        {/* ═══════════ COLUMN 3: Guardrail Validator Output ═══════════ */}
        <aside className="w-80 min-w-80 flex flex-col bg-slate-950 overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
            <div className="text-xs font-mono text-slate-400 tracking-widest uppercase">Guardrail Validator</div>
          </div>

          <div className="p-4 space-y-4">

            {/* Pillar Checks */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-3">Safety Pillar Checks</div>
              <div className="space-y-2">
                {display ? (
                  display.pillars.map((p, i) => (
                    <div key={i} className="flex items-start gap-2 slide-in" style={{ animationDelay: `${i * 80}ms` }}>
                      <PillarIcon status={p.status} />
                      <div className="flex-1">
                        <div className="font-mono text-xs text-slate-300 font-medium">{p.name}</div>
                        <div className="font-mono text-[10px] text-slate-600 leading-tight mt-0.5">{p.detail}</div>
                      </div>
                    </div>
                  ))
                ) : loading ? (
                  ['Identity Match', 'Authorization', 'Data Sensitivity', 'Purpose Alignment', 'Reversibility'].map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-cyan-800 text-lg animate-pulse">◌</span>
                      <div className="font-mono text-xs text-slate-700 animate-pulse">{name}</div>
                    </div>
                  ))
                ) : (
                  ['Identity Match', 'Authorization', 'Data Sensitivity', 'Purpose Alignment', 'Reversibility'].map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-slate-700 text-lg">○</span>
                      <div className="font-mono text-xs text-slate-700">{name}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Risk Score */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col items-center">
              <div className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-3">Risk Score</div>
              <RiskDial
                key={animKey}
                score={display?.riskScore ?? 0}
                animated={!!display}
              />
            </div>

            {/* Final Decision */}
            <div>
              <div className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-2">Final Decision</div>
              <DecisionBanner decision={currentDecision} loading={loading} />
            </div>

            {/* Explainability Log */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4" ref={logRef}>
              <div className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-2">
                📋 Explainability Log
              </div>
              {loading ? (
                <div className="font-mono text-xs text-slate-600 animate-pulse">
                  Running guardrail pipeline…
                </div>
              ) : display ? (
                <div className={`font-mono text-xs text-slate-300 leading-relaxed ${typing ? 'cursor' : ''}`}>
                  {typedText}
                </div>
              ) : (
                <div className="font-mono text-xs text-slate-700">
                  No action intercepted yet. Explanation will appear here.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

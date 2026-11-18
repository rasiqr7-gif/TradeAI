import { useState, useEffect } from "react"
import axios from "axios"

const API = "http://localhost:3001"
const GATE_BACKTEST = 20
const GATE_LIVE = 10
const PATTERN_MIN = 5

// ─── MATH ────────────────────────────────────────────────────────────────────
function core(trades) {
  const wins   = trades.filter(t => parseFloat(t.pips) > 0)
  const losses = trades.filter(t => parseFloat(t.pips) < 0)
  const wr     = trades.length ? (wins.length / trades.length) * 100 : 0
  const avgW   = wins.length   ? wins.reduce((s,t)   => s + parseFloat(t.pips), 0) / wins.length   : 0
  const avgL   = losses.length ? losses.reduce((s,t) => s + Math.abs(parseFloat(t.pips)), 0) / losses.length : 0
  const exp    = (wr / 100) * avgW - (1 - wr / 100) * avgL
  const pnl    = trades.reduce((s,t) => s + ((parseFloat(t.pnl) || 0) - (parseFloat(t.charges) || 0)), 0)
  const rrArr  = trades.filter(t => t.achieved_rr && parseFloat(t.achieved_rr) !== 0)
  const avgRR  = rrArr.length ? rrArr.reduce((s,t) => s + parseFloat(t.achieved_rr), 0) / rrArr.length : 0
  const gW     = wins.reduce((s,t) => s + (parseFloat(t.pnl) || 0), 0)
  const gL     = Math.abs(losses.reduce((s,t) => s + (parseFloat(t.pnl) || 0), 0))
  const pf     = gL > 0 ? gW / gL : gW > 0 ? 99 : 0
  return { wins, losses, wr, avgW, avgL, exp, pnl, avgRR, pf, total: trades.length }
}

function byGroup(trades, key, vals) {
  return vals.map(v => {
    const g    = trades.filter(t => t[key] === v)
    const w    = g.filter(t => parseFloat(t.pips) > 0)
    const pnl  = g.reduce((s,t) => s + ((parseFloat(t.pnl) || 0) - (parseFloat(t.charges) || 0)), 0)
    const rr   = g.filter(t => t.achieved_rr && parseFloat(t.achieved_rr) !== 0)
    const avgRR  = rr.length ? (rr.reduce((s,t) => s + parseFloat(t.achieved_rr), 0) / rr.length).toFixed(2) : "—"
    const pr   = g.filter(t => t.planned_rr && parseFloat(t.planned_rr) > 0)
    const avgP = pr.length ? (pr.reduce((s,t) => s + parseFloat(t.planned_rr), 0) / pr.length).toFixed(2) : "—"
    return { name: v, n: g.length, w: w.length, wr: g.length ? (w.length / g.length) * 100 : 0, pnl, avgRR, avgP }
  }).filter(r => r.n > 0)
}

function moodBuckets(trades) {
  return [
    { label: "1–3", min: 1, max: 3,  color: "#CC4444" },
    { label: "4–6", min: 4, max: 6,  color: "#C9A84C" },
    { label: "7–10",min: 7, max: 10, color: "#3DAA6A" },
  ].map(b => {
    const g = trades.filter(t => { const m = parseInt(t.mood); return !isNaN(m) && m >= b.min && m <= b.max })
    const w = g.filter(t => parseFloat(t.pips) > 0)
    return { ...b, n: g.length, wr: g.length ? (w.length / g.length) * 100 : 0 }
  })
}

function dowStats(trades) {
  return ["Mon","Tue","Wed","Thu","Fri"].map(d => {
    const g   = trades.filter(t => t.date && new Date(t.date).toLocaleDateString("en-US", { weekday: "short" }) === d)
    const w   = g.filter(t => parseFloat(t.pips) > 0)
    const pnl = g.reduce((s,t) => s + ((parseFloat(t.pnl) || 0) - (parseFloat(t.charges) || 0)), 0)
    return { d, n: g.length, w: w.length, wr: g.length ? (w.length / g.length) * 100 : 0, pnl }
  })
}

function emoSplit(trades) {
  const s = trades.filter(t => { try { return JSON.parse(t.execution_review || "[]").includes("STABLE") } catch { return false } })
  const e = trades.filter(t => { try { const r = JSON.parse(t.execution_review || "[]"); return r.some(x => ["FOMO","GREED","FEAR","FOGS"].includes(x)) } catch { return false } })
  const sw = s.filter(t => parseFloat(t.pips) > 0)
  const ew = e.filter(t => parseFloat(t.pips) > 0)
  return {
    s: { n: s.length, wr: s.length ? (sw.length / s.length) * 100 : 0, pnl: s.reduce((a,t) => a + ((parseFloat(t.pnl)||0) - (parseFloat(t.charges)||0)), 0) },
    e: { n: e.length, wr: e.length ? (ew.length / e.length) * 100 : 0, pnl: e.reduce((a,t) => a + ((parseFloat(t.pnl)||0) - (parseFloat(t.charges)||0)), 0) },
  }
}

function psychTags(trades) {
  const c = {}
  trades.forEach(t => { try { JSON.parse(t.execution_review || "[]").forEach(r => { c[r] = (c[r] || 0) + 1 }) } catch {} })
  return c
}

function patterns(trades) {
  const m = {}
  trades.forEach(t => {
    const k = `${t.session}||${t.grade}`
    if (!m[k]) m[k] = { session: t.session, grade: t.grade, n: 0, w: 0 }
    m[k].n++
    if (parseFloat(t.pips) > 0) m[k].w++
  })
  return Object.values(m)
    .filter(p => p.n >= PATTERN_MIN)
    .map(p => ({ ...p, wr: (p.w / p.n) * 100 }))
    .sort((a,b) => b.wr - a.wr)
}

// ─── SVG CHARTS ──────────────────────────────────────────────────────────────
function EquityCurve({ trades }) {
  if (trades.length < 2) return (
    <div className="flex items-center justify-center h-24 text-[#333333] text-sm">
      Not enough data to draw curve
    </div>
  )
  const cumul = trades.slice().reverse().reduce((acc, t, i) => {
    acc.push((acc[i-1] || 0) + (parseFloat(t.pnl) || 0))
    return acc
  }, [])
  const mn  = Math.min(...cumul, 0)
  const mx  = Math.max(...cumul, 0.01)
  const rng = mx - mn || 1
  const W = 100, H = 52, pad = 2
  const pts = cumul.map((v, i) => {
    const x = pad + (i / (cumul.length - 1)) * (W - pad * 2)
    const y = pad + (1 - (v - mn) / rng) * (H - pad * 2)
    return [x, y]
  })
  const line = pts.map(p => p.join(",")).join(" ")
  const fill = `${pad},${H - pad} ${line} ${pts[pts.length-1][0]},${H - pad}`
  const last = cumul[cumul.length - 1]
  const color = last >= 0 ? "#3DAA6A" : "#CC4444"

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 80 }}>
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill="url(#curveGrad)" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="1.2" fill={color} />
    </svg>
  )
}

function MiniBar({ value, max, color, height = 8 }) {
  const pct = max > 0 ? Math.min((Math.abs(value) / max) * 100, 100) : 0
  return (
    <div className="w-full bg-[#1A1A1A] rounded overflow-hidden" style={{ height }}>
      <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function WRRing({ wr, n, size = 56 }) {
  const color  = n < PATTERN_MIN ? "#886600" : wr >= 50 ? "#3DAA6A" : "#CC4444"
  const r      = (size - 6) / 2
  const circ   = 2 * Math.PI * r
  const dash   = (Math.min(wr, 100) / 100) * circ
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1A1A1A" strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{n > 0 ? `${wr.toFixed(0)}%` : "—"}</span>
      </div>
    </div>
  )
}

function DOWBars({ data }) {
  const maxA = Math.max(...data.map(d => Math.abs(d.pnl)), 0.01)
  return (
    <div className="flex items-end gap-1.5" style={{ height: 64 }}>
      {data.map(d => {
        const h     = d.n > 0 ? Math.max((Math.abs(d.pnl) / maxA) * 52, 4) : 4
        const color = d.pnl > 0 ? "#3DAA6A" : d.pnl < 0 ? "#CC4444" : "#222222"
        return (
          <div key={d.d} className="flex flex-col items-center justify-end flex-1 gap-1">
            {d.n > 0 && <span style={{ fontSize: 9, color, fontWeight: 700 }}>{d.wr.toFixed(0)}%</span>}
            <div style={{ width: "100%", height: h, backgroundColor: color, borderRadius: 2, opacity: 0.85 }} />
            <span style={{ fontSize: 9, color: "#444444" }}>{d.d}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── UI ATOMS ────────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-[#111111] border border-[#222222] rounded p-5">
      {title && (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-0.5 h-3.5 bg-[#C9A84C] rounded" />
          <span className="text-[#C9A84C] text-xs font-bold uppercase tracking-wider">{title}</span>
        </div>
      )}
      {children}
    </div>
  )
}

function StatRow({ label, value, color = "#CCCCCC", sub }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-[#1A1A1A] last:border-0">
      <span className="text-[#555555] text-sm">{label}</span>
      <div className="text-right">
        <span className="text-sm font-bold" style={{ color }}>{value}</span>
        {sub && <div className="text-xs text-[#444444] mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function BigStat({ label, value, color = "#C9A84C", sub, badge }) {
  return (
    <div className="bg-[#0D0D0D] border border-[#1E1E1E] rounded p-4">
      <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">{label}</div>
      <div className="text-2xl font-bold mb-1" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-[#444444]">{sub}</div>}
      {badge && <div className="mt-2">{badge}</div>}
    </div>
  )
}

function Badge({ label, color, bg }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold"
      style={{ color, backgroundColor: bg, border: `1px solid ${color}33` }}>
      {label}
    </span>
  )
}

function WRCell({ wr, n }) {
  if (!n) return <span className="text-[#333333] text-sm">—</span>
  const color = n < PATTERN_MIN ? "#886600" : wr >= 50 ? "#3DAA6A" : "#CC4444"
  return (
    <span className="text-sm font-bold" style={{ color }}>
      {wr.toFixed(1)}%{n < PATTERN_MIN && <span className="text-[#886600] ml-1 text-xs">⚠</span>}
    </span>
  )
}

function GBar({ label, n, req }) {
  const done = n >= req
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-[#555555]">{label}</span>
        <span className="font-bold" style={{ color: done ? "#3DAA6A" : "#C9A84C" }}>
          {n} / {req} {done ? "✓" : `— ${req - n} more`}
        </span>
      </div>
      <div className="h-1 bg-[#1A1A1A] rounded overflow-hidden">
        <div className="h-full rounded transition-all duration-500"
          style={{ width: `${Math.min((n / req) * 100, 100)}%`, backgroundColor: done ? "#3DAA6A" : "#C9A84C" }} />
      </div>
    </div>
  )
}

const GC = { "A+": "#C9A84C", "A": "#3DAA6A", "B": "#886600" }

// ─── FINAL BOSS COMPONENTS ───────────────────────────────────────────────────

function BossStatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "#0A0A0A",
      border: "1px solid #1E1E1E",
      borderRadius: 6,
      padding: "16px 18px"
    }}>
      <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || "#C9A84C", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#444", marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function BossGapBar({ liveWR, btWR }) {
  const lPct = Math.min(liveWR, 100)
  const bPct = Math.min(btWR, 100)
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginBottom: 6 }}>
        <span>0%</span><span>50%</span><span>100%</span>
      </div>
      <div style={{ position: "relative", height: 10, background: "#111", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${bPct}%`, background: "#3DAA6A", opacity: 0.35, borderRadius: 5 }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${lPct}%`, background: "#CC4444", borderRadius: 5 }} />
      </div>
      <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#555" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#CC4444", marginRight: 5, verticalAlign: "middle" }}></span>Live {liveWR.toFixed(1)}%</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#3DAA6A", opacity: 0.6, marginRight: 5, verticalAlign: "middle" }}></span>Backtest {btWR.toFixed(1)}%</span>
        <span style={{ marginLeft: "auto", color: btWR - liveWR > 5 ? "#CC4444" : "#3DAA6A", fontWeight: 700 }}>
          Gap: {(btWR - liveWR).toFixed(1)}pp
        </span>
      </div>
    </div>
  )
}

function BossGradeRow({ grade, data, btData }) {
  const color = GC[grade] || "#888"
  const live = data.find(g => g.name === grade)
  const bt   = btData.find(g => g.name === grade)
  if (!live && !bt) return null
  const liveWR  = live ? live.wr  : null
  const liveRR  = live ? live.avgRR : "—"
  const liveN   = live ? live.n   : 0
  const btWR    = bt   ? bt.wr   : null
  const btRR    = bt   ? bt.avgRR : "—"
  const verdict = liveWR !== null && btWR !== null
    ? liveWR >= btWR * 0.7 ? "on track" : liveWR < 30 ? "broken" : "gap"
    : "no data"
  const verdictColor = verdict === "on track" ? "#3DAA6A" : verdict === "broken" ? "#CC4444" : "#886600"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #1A1A1A" }}>
      <div style={{ width: 28, fontWeight: 800, fontSize: 14, color, flexShrink: 0 }}>{grade}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
          <span style={{ color: "#444" }}>Live: <span style={{ color: liveWR !== null ? (liveWR >= 50 ? "#3DAA6A" : "#CC4444") : "#444", fontWeight: 700 }}>{liveWR !== null ? `${liveWR.toFixed(0)}%` : "—"}</span> · RR {liveRR} · {liveN}t</span>
          <span style={{ color: "#444" }}>BT: <span style={{ color: btWR !== null ? (btWR >= 50 ? "#3DAA6A" : "#CC4444") : "#444", fontWeight: 700 }}>{btWR !== null ? `${btWR.toFixed(0)}%` : "—"}</span> · RR {btRR}</span>
        </div>
        <div style={{ height: 4, background: "#111", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(liveWR || 0, 100)}%`, background: liveWR >= 50 ? "#3DAA6A" : "#CC4444", borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: verdictColor, textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0, width: 56, textAlign: "right" }}>{verdict}</div>
    </div>
  )
}

function BossPsychRow({ tag, count, total, isPositive }) {
  const pct   = total > 0 ? (count / total) * 100 : 0
  const color = isPositive ? "#3DAA6A" : tag === "Wrong side of probability" ? "#CC4444" : tag === "FOMO" || tag === "FEAR" || tag === "GREED" || tag === "FOGS" ? "#CC4444" : "#886600"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #141414" }}>
      <div style={{ fontSize: 12, color, fontWeight: 700, width: 200, flexShrink: 0 }}>{tag}</div>
      <div style={{ flex: 1, height: 4, background: "#111", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color, width: 32, textAlign: "right", flexShrink: 0 }}>{count}×</div>
    </div>
  )
}

function BossAIReport({ text }) {
  if (!text) return null
  // Split on double newlines or sentence blocks starting with known keywords
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean)
  const isDirective = l => /^(directive|focus|action|bottom line|one thing|priority)/i.test(l)
  const isWarning   = l => l.startsWith("⚠") || /^(warning|problem|issue|broken|failing)/i.test(l)

  return (
    <div style={{ marginTop: 0 }}>
      {lines.map((line, i) => {
        if (isDirective(line)) {
          return (
            <div key={i} style={{
              background: "#0A1800",
              border: "1px solid #3DAA6A44",
              borderLeft: "3px solid #3DAA6A",
              borderRadius: 6,
              padding: "12px 16px",
              marginTop: 16,
              fontSize: 13,
              color: "#3DAA6A",
              fontWeight: 700,
              lineHeight: 1.6
            }}>{line}</div>
          )
        }
        if (isWarning(line)) {
          return (
            <div key={i} style={{
              display: "flex",
              gap: 10,
              padding: "8px 0",
              borderBottom: "1px solid #1A1A1A",
              fontSize: 13,
              color: "#CC4444",
              lineHeight: 1.6
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
              <span>{line.replace(/^⚠\s*/, "")}</span>
            </div>
          )
        }
        return (
          <div key={i} style={{
            padding: "8px 0",
            borderBottom: "1px solid #141414",
            fontSize: 13,
            color: "#AAAAAA",
            lineHeight: 1.7
          }}>{line}</div>
        )
      })}
    </div>
  )
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function Analysis() {
  const [live,      setLive]      = useState([])
  const [bt,        setBt]        = useState([])
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState("live")
  const [aiReport,  setAiReport]  = useState("")
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/trades`),
      axios.get(`${API}/api/backtest`)
    ]).then(([l, b]) => { setLive(l.data); setBt(b.data) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const lv      = core(live)
  const bv      = core(bt)
  const cleanBT = bt.filter(t => !t.hindsight_bias)
  const cleanWR = core(cleanBT).wr
  const hind    = bt.filter(t => t.hindsight_bias === 1 || t.hindsight_bias === true).length
  const wTake   = bt.filter(t => t.would_take_live === 1 || t.would_take_live === true).length
  const gate    = bt.length >= GATE_BACKTEST && live.length >= GATE_LIVE

  const lvG   = byGroup(live, "grade",   ["A+","A","B"])
  const lvS   = byGroup(live, "session", ["LONDON","NY AM","NY PM","London","New York"]).filter(r => r.n > 0)
  const lvP   = byGroup(live, "pair",    ["EURUSD","XAUUSD"]).filter(r => r.n > 0)
  const lvPat = patterns(live)
  const lvDow = dowStats(live)
  const lvMod = moodBuckets(live)
  const lvEmo = emoSplit(live)
  const lvPsy = psychTags(live)

  const btG   = byGroup(bt, "grade",   ["A+","A","B"])
  const btS   = byGroup(bt, "session", ["LONDON","NY AM","NY PM","London","New York"]).filter(r => r.n > 0)
  const btPat = patterns(bt)

  // Boss-specific derived stats
  const wrGap       = bv.wr - lv.wr
  const rrGap       = bv.avgRR - lv.avgRR
  const psychTotal  = Object.values(lvPsy).reduce((s, v) => s + v, 0)
  const wrongSide   = lvPsy["Wrong side of probability"] || 0
  const fomoCount   = lvPsy["FOMO"] || 0
  const stableCount = lvPsy["STABLE"] || 0
  const bossStatus  = lv.wr === 0 ? "EXECUTION FAILURE"
    : wrGap > 20 ? "CRITICAL GAP"
    : wrGap > 10 ? "EXECUTION GAP"
    : "TRACKING WELL"
  const bossStatusColor = lv.wr === 0 || wrGap > 20 ? "#CC4444" : wrGap > 10 ? "#C9A84C" : "#3DAA6A"

  async function runBoss() {
    if (!gate) return
    setAiLoading(true); setAiReport(""); setTab("boss")
    try {
      const r = await axios.post(`${API}/api/ai`, {
        system: "You are a senior forex trading mentor. Direct, experienced, no filler. Reference exact numbers only. Only confirm patterns with 5+ trades. End with exactly ONE directive — the single most important thing this trader must focus on right now. Start each finding on a new line.",
        prompt: `LIVE (${live.length} trades)\nWR:${lv.wr.toFixed(1)}% Expectancy:${lv.exp.toFixed(2)}pips PF:${lv.pf.toFixed(2)} AvgRR:${lv.avgRR.toFixed(2)} PnL:$${lv.pnl.toFixed(0)}\nGrades:${JSON.stringify(lvG)}\nSessions:${JSON.stringify(lvS)}\nConfirmed patterns(5+):${JSON.stringify(lvPat)}\nPsychology:${JSON.stringify(lvPsy)}\n\nBACKTEST (${bt.length} trades)\nWR:${bv.wr.toFixed(1)}% CleanWR:${cleanWR.toFixed(1)}% Hindsight:${hind} WouldTake:${wTake}\nGrades:${JSON.stringify(btG)}\n\nExecution gap: WR ${wrGap.toFixed(1)}% RR ${rrGap.toFixed(2)}\n\nTell me exactly what you see. Brutal and direct. Start your final directive with the word DIRECTIVE:`
      })
      setAiReport(r.data.response)
    } catch { setAiReport("Analysis failed. Check backend is running.") }
    finally  { setAiLoading(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[#444444] text-sm">Loading analysis...</div>
    </div>
  )

  const TABS = [
    { key: "live",     label: "Live Trading" },
    { key: "backtest", label: "Backtest"      },
    { key: "psych",    label: "Psychology"    },
    { key: "boss",     label: "👑 Final Boss" },
  ]

  return (
    <div className="p-6 max-w-5xl">

      {/* ── HEADER ── */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-[#C9A84C] text-2xl font-bold">Analysis</h2>
          <p className="text-[#444444] text-sm mt-1">{live.length} live trades · {bt.length} backtests</p>
        </div>
        {gate ? (
          <button onClick={runBoss} disabled={aiLoading}
            className="px-5 py-2.5 bg-[#C9A84C] text-[#0D0D0D] rounded text-sm font-bold hover:bg-[#E0BC5C] disabled:opacity-50 flex items-center gap-2">
            {aiLoading ? <><span className="animate-pulse">👑</span> Analyzing...</> : <><span>👑</span> Final Boss</>}
          </button>
        ) : (
          <button onClick={() => setTab("boss")}
            className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333333] text-[#444444] rounded text-sm font-bold hover:border-[#555555]">
            👑 Final Boss — Locked
          </button>
        )}
      </div>

      {/* ── TABS ── */}
      <div className="flex gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
              tab === t.key ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"
            }`}>{t.label}
          </button>
        ))}
      </div>

      {/* ════════════ LIVE TAB ════════════════════════════════════════════════ */}
      {tab === "live" && (
        live.length === 0
          ? <div className="text-center py-16 text-[#333333]"><div className="text-4xl mb-3">📊</div><p className="text-sm">No live trades yet.</p></div>
          : <div className="space-y-4">

              {live.length < GATE_LIVE && (
                <div className="bg-[#1A1000] border border-[#886600] rounded px-4 py-2">
                  <p className="text-[#886600] text-xs font-bold">⚠ Only {live.length} live trades — {GATE_LIVE - live.length} more needed before patterns are reliable.</p>
                </div>
              )}

              {/* EQUITY CURVE + TOP STATS */}
              <div className="bg-[#111111] border border-[#C9A84C] rounded p-5">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="text-[#555555] text-xs uppercase tracking-wider mb-1">Cumulative P&L</div>
                    <div className="text-3xl font-bold" style={{ color: lv.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                      {lv.pnl >= 0 ? "+" : "−"}${Math.abs(lv.pnl).toFixed(0)}
                    </div>
                  </div>
                  <div className="flex gap-6 text-right">
                    {[
                      { label:"Win Rate",      value:`${lv.wr.toFixed(1)}%`,              color: lv.wr >= 50 ? "#3DAA6A" : "#CC4444" },
                      { label:"Expectancy",    value:`${lv.exp > 0 ? "+" : ""}${lv.exp.toFixed(1)}p`, color: lv.exp > 0 ? "#3DAA6A" : "#CC4444" },
                      { label:"Profit Factor", value: isFinite(lv.pf) ? lv.pf.toFixed(2) : "∞",     color: lv.pf >= 1.5 ? "#3DAA6A" : lv.pf >= 1 ? "#C9A84C" : "#CC4444" },
                      { label:"Avg RR",        value: lv.avgRR.toFixed(2),                color:"#C9A84C" },
                    ].map(s => (
                      <div key={s.label}>
                        <div className="text-[#444444] text-xs uppercase tracking-wider mb-1">{s.label}</div>
                        <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <EquityCurve trades={live} />
              </div>

              {/* 6 KPI GRID */}
              <div className="grid grid-cols-6 gap-3">
                {[
                  { label:"Trades",     value: live.length,              color:"#CCCCCC" },
                  { label:"Wins",       value: lv.wins.length,           color:"#3DAA6A" },
                  { label:"Losses",     value: lv.losses.length,         color:"#CC4444" },
                  { label:"Avg W pip",  value:`+${lv.avgW.toFixed(1)}`,  color:"#3DAA6A" },
                  { label:"Avg L pip",  value:`-${lv.avgL.toFixed(1)}`,  color:"#CC4444" },
                  { label:"Expectancy", value:`${lv.exp > 0 ? "+" : ""}${lv.exp.toFixed(2)}`,
                    color: lv.exp > 5 ? "#3DAA6A" : lv.exp > 0 ? "#C9A84C" : "#CC4444" },
                ].map(k => (
                  <div key={k.label} className="bg-[#0D0D0D] border border-[#1E1E1E] rounded p-3 text-center">
                    <div className="text-[#444444] text-xs uppercase tracking-wider mb-1.5">{k.label}</div>
                    <div className="text-xl font-bold" style={{ color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* GRADE PERFORMANCE */}
              <Section title="Performance by Grade">
                <div className="space-y-3">
                  {lvG.map(g => {
                    const color = GC[g.name] || "#888888"
                    const maxPnl = Math.max(...lvG.map(x => Math.abs(x.pnl)), 0.01)
                    return (
                      <div key={g.name}>
                        <div className="flex items-center gap-4 mb-1.5">
                          <span className="text-sm font-bold w-6" style={{ color }}>{g.name}</span>
                          <span className="text-[#444444] text-xs w-12">{g.n} trades</span>
                          <WRRing wr={g.wr} n={g.n} size={44} />
                          <div className="flex-1">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-[#555555]">RR achieved {g.avgRR} · planned {g.avgP}</span>
                              <span className="font-bold" style={{ color: g.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                                {g.pnl >= 0 ? "+" : ""}${g.pnl.toFixed(0)}
                              </span>
                            </div>
                            <MiniBar value={Math.abs(g.pnl)} max={maxPnl} color={g.pnl >= 0 ? "#3DAA6A" : "#CC4444"} height={5} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[#333333] text-xs mt-3">⚠ = fewer than {PATTERN_MIN} trades — not statistically reliable</p>
              </Section>

              {/* SESSION + PAIR */}
              <div className="grid grid-cols-2 gap-4">
                <Section title="Performance by Session">
                  <div className="space-y-3">
                    {lvS.map(s => {
                      const maxWR = Math.max(...lvS.map(x => x.wr), 0.01)
                      return (
                        <div key={s.name}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm text-[#CCCCCC]">{s.name}</span>
                            <div className="flex gap-3 text-xs">
                              <span className="text-[#444444]">{s.n}t</span>
                              <WRCell wr={s.wr} n={s.n} />
                              <span className="font-bold" style={{ color: s.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                                {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(0)}
                              </span>
                            </div>
                          </div>
                          <MiniBar value={s.wr} max={maxWR} color={s.wr >= 50 ? "#3DAA6A" : "#CC4444"} height={4} />
                        </div>
                      )
                    })}
                  </div>
                </Section>

                <Section title="Performance by Pair">
                  <div className="space-y-4">
                    {lvP.map(p => (
                      <div key={p.name} className="flex items-center gap-4">
                        <WRRing wr={p.wr} n={p.n} size={52} />
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-bold text-[#CCCCCC]">{p.name}</span>
                            <span className="text-xs font-bold" style={{ color: p.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                              {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(0)}
                            </span>
                          </div>
                          <div className="text-xs text-[#444444]">{p.n} trades · avg RR {p.avgRR}</div>
                          <div className="mt-1.5">
                            <MiniBar value={p.wr} max={100} color={p.wr >= 50 ? "#3DAA6A" : "#CC4444"} height={4} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>

              {/* DOW + MOOD */}
              <div className="grid grid-cols-2 gap-4">
                <Section title="Day of Week">
                  <DOWBars data={lvDow} />
                  <div className="flex gap-3 mt-3 flex-wrap">
                    {lvDow.filter(d => d.n > 0).map(d => (
                      <div key={d.d} className="text-xs text-[#444444]">
                        {d.d}: <span className="font-bold" style={{ color: d.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>{d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Win Rate by Mood">
                  <div className="space-y-4">
                    {lvMod.map(m => (
                      <div key={m.label}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-sm text-[#888888]">Mood {m.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[#444444]">{m.n} trades</span>
                            <span className="text-sm font-bold" style={{ color: m.color }}>{m.n > 0 ? `${m.wr.toFixed(0)}%` : "—"}</span>
                          </div>
                        </div>
                        <MiniBar value={m.wr} max={100} color={m.color} height={5} />
                      </div>
                    ))}
                  </div>
                </Section>
              </div>

              {/* CONFIRMED EDGE */}
              {lvPat.length > 0 && (
                <Section title={`Confirmed Edge — ${PATTERN_MIN}+ trades only`}>
                  <div className="grid grid-cols-3 gap-3">
                    {lvPat.map(p => {
                      const color = p.wr >= 60 ? "#3DAA6A" : p.wr >= 50 ? "#C9A84C" : "#CC4444"
                      return (
                        <div key={`${p.session}${p.grade}`}
                          className="bg-[#0D0D0D] border border-[#1E1E1E] rounded p-3 flex justify-between items-center">
                          <div>
                            <div className="text-xs text-[#555555]">{p.session}</div>
                            <div className="text-sm font-bold" style={{ color: GC[p.grade] || "#888888" }}>{p.grade}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold" style={{ color }}>{p.wr.toFixed(0)}%</div>
                            <div className="text-xs text-[#444444]">{p.n} trades</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}
            </div>
      )}

      {/* ════════════ BACKTEST TAB ════════════════════════════════════════════ */}
      {tab === "backtest" && (
        bt.length === 0
          ? <div className="text-center py-16 text-[#333333]"><div className="text-4xl mb-3">🔬</div><p className="text-sm">No backtests yet. Need {GATE_BACKTEST} to unlock Final Boss.</p></div>
          : <div className="space-y-4">

              {/* KPIs */}
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label:"Backtests",    value: bt.length,                    color:"#CCCCCC" },
                  { label:"Win Rate",     value:`${bv.wr.toFixed(1)}%`,        color: bv.wr >= 50 ? "#3DAA6A" : "#CC4444" },
                  { label:"Clean WR",     value:`${cleanWR.toFixed(1)}%`,      color: cleanWR >= 50 ? "#3DAA6A" : "#CC4444", sub:"excl. hindsight" },
                  { label:"Avg RR",       value: bv.avgRR.toFixed(2),          color:"#C9A84C" },
                  { label:"Expectancy",   value:`${bv.exp > 0 ? "+" : ""}${bv.exp.toFixed(1)}p`, color: bv.exp > 0 ? "#3DAA6A" : "#CC4444" },
                ].map(k => (
                  <div key={k.label} className="bg-[#111111] border border-[#222222] rounded p-4">
                    <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">{k.label}</div>
                    <div className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
                    {k.sub && <div className="text-xs text-[#444444] mt-1">{k.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#111111] border border-[#222222] rounded p-4">
                  <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">Hindsight Bias</div>
                  <div className="text-2xl font-bold mb-1" style={{ color: hind > 0 ? "#CC4444" : "#3DAA6A" }}>{hind}</div>
                  {hind > 0 && <p className="text-[#CC4444] text-xs">Real WR: {cleanWR.toFixed(1)}% not {bv.wr.toFixed(1)}%</p>}
                </div>
                <div className="bg-[#111111] border border-[#222222] rounded p-4">
                  <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">Would Take Live</div>
                  <div className="text-2xl font-bold text-[#C9A84C] mb-1">{wTake}</div>
                  <p className="text-[#444444] text-xs">{bt.length > 0 ? ((wTake / bt.length) * 100).toFixed(0) : 0}% of backtests</p>
                </div>
                <div className="bg-[#111111] border border-[#222222] rounded p-4">
                  <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">Profit Factor</div>
                  <div className="text-2xl font-bold mb-1" style={{ color: bv.pf >= 1.5 ? "#3DAA6A" : bv.pf >= 1 ? "#C9A84C" : "#CC4444" }}>
                    {isFinite(bv.pf) ? bv.pf.toFixed(2) : "∞"}
                  </div>
                  <p className="text-[#444444] text-xs">{bv.pf >= 1.5 ? "Strong edge" : bv.pf >= 1 ? "Marginal" : "Losing money"}</p>
                </div>
              </div>

              {hind > 0 && (
                <div className="bg-[#1A0A0A] border border-[#CC4444] rounded px-4 py-3">
                  <p className="text-[#CC4444] text-xs font-bold">⚠ {hind} hindsight-biased trades — grade your setup BEFORE seeing the result</p>
                </div>
              )}

              <Section title="Backtest Win Rate by Grade">
                <div className="space-y-3">
                  {btG.map(g => {
                    const color = GC[g.name] || "#888888"
                    return (
                      <div key={g.name} className="flex items-center gap-4">
                        <span className="text-sm font-bold w-6" style={{ color }}>{g.name}</span>
                        <span className="text-[#444444] text-xs w-12">{g.n} trades</span>
                        <WRRing wr={g.wr} n={g.n} size={44} />
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <WRCell wr={g.wr} n={g.n} />
                            <span className="text-[#444444]">avg RR {g.avgRR}</span>
                          </div>
                          <MiniBar value={g.wr} max={100} color={g.wr >= 50 ? "#3DAA6A" : "#CC4444"} height={4} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>

              <Section title="Backtest Win Rate by Session">
                <div className="space-y-3">
                  {btS.map(s => (
                    <div key={s.name}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-[#CCCCCC]">{s.name}</span>
                        <div className="flex gap-3 text-xs">
                          <span className="text-[#444444]">{s.n}t</span>
                          <WRCell wr={s.wr} n={s.n} />
                          <span className="text-[#555555]">RR {s.avgRR}</span>
                        </div>
                      </div>
                      <MiniBar value={s.wr} max={100} color={s.wr >= 50 ? "#3DAA6A" : "#CC4444"} height={4} />
                    </div>
                  ))}
                </div>
              </Section>

              {btPat.length > 0 && (
                <Section title={`Confirmed Backtest Edge — ${PATTERN_MIN}+ trades only`}>
                  <div className="grid grid-cols-3 gap-3">
                    {btPat.map(p => {
                      const color = p.wr >= 60 ? "#3DAA6A" : p.wr >= 50 ? "#C9A84C" : "#CC4444"
                      return (
                        <div key={`${p.session}${p.grade}`}
                          className="bg-[#0D0D0D] border border-[#1E1E1E] rounded p-3 flex justify-between items-center">
                          <div>
                            <div className="text-xs text-[#555555]">{p.session}</div>
                            <div className="text-sm font-bold" style={{ color: GC[p.grade] || "#888888" }}>{p.grade}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold" style={{ color }}>{p.wr.toFixed(0)}%</div>
                            <div className="text-xs text-[#444444]">{p.n} trades</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}

              <Section title="Progress to Final Boss">
                <GBar label="Backtests required"   n={bt.length}   req={GATE_BACKTEST} />
                <GBar label="Live trades required" n={live.length} req={GATE_LIVE} />
              </Section>
            </div>
      )}

      {/* ════════════ PSYCHOLOGY TAB ══════════════════════════════════════════ */}
      {tab === "psych" && (
        live.length === 0
          ? <div className="text-center py-16 text-[#333333]"><div className="text-4xl mb-3">🧠</div><p className="text-sm">No psychology data yet.</p></div>
          : <div className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-5">
                  <div className="text-[#3DAA6A] text-xs font-bold uppercase tracking-wider mb-3">Stable Trades</div>
                  <div className="text-4xl font-bold text-[#3DAA6A] mb-2">{lvEmo.s.wr.toFixed(1)}%</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#446644]">{lvEmo.s.n} trades</span>
                    <span className="font-bold" style={{ color: lvEmo.s.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                      {lvEmo.s.pnl >= 0 ? "+" : ""}${lvEmo.s.pnl.toFixed(0)} P&L
                    </span>
                  </div>
                  <div className="mt-3"><MiniBar value={lvEmo.s.wr} max={100} color="#3DAA6A" height={4} /></div>
                </div>
                <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-5">
                  <div className="text-[#CC4444] text-xs font-bold uppercase tracking-wider mb-3">Emotional Trades</div>
                  <div className="text-4xl font-bold text-[#CC4444] mb-2">{lvEmo.e.wr.toFixed(1)}%</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#884444]">{lvEmo.e.n} trades</span>
                    <span className="font-bold" style={{ color: lvEmo.e.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>
                      {lvEmo.e.pnl >= 0 ? "+" : ""}${lvEmo.e.pnl.toFixed(0)} P&L
                    </span>
                  </div>
                  <div className="mt-3"><MiniBar value={lvEmo.e.wr} max={100} color="#CC4444" height={4} /></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Section title="Execution Tag Frequency">
                  {(() => {
                    const tags  = Object.entries(lvPsy).sort((a,b) => b[1] - a[1])
                    const total = tags.reduce((s,[,v]) => s + v, 0) || 1
                    const tc    = { STABLE:"#3DAA6A", FOGS:"#CC4444", FOMO:"#CC4444", GREED:"#CC4444", FEAR:"#CC4444", "Method mistake":"#886600", "Psychological mistake":"#886600", "Wrong side of probability":"#886600" }
                    return tags.length === 0
                      ? <p className="text-[#333333] text-sm">No tags logged.</p>
                      : <div className="space-y-3">
                          {tags.map(([tag, count]) => {
                            const color = tc[tag] || "#888888"
                            const pct   = (count / total) * 100
                            return (
                              <div key={tag}>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-sm font-bold" style={{ color }}>{tag}</span>
                                  <span className="text-xs text-[#444444]">{count}× · {pct.toFixed(0)}%</span>
                                </div>
                                <MiniBar value={pct} max={100} color={color} height={4} />
                              </div>
                            )
                          })}
                        </div>
                  })()}
                </Section>

                <Section title="Win Rate by Mood">
                  <div className="space-y-4">
                    {lvMod.map(m => (
                      <div key={m.label} className="flex items-center gap-4">
                        <WRRing wr={m.n > 0 ? m.wr : 0} n={m.n} size={52} />
                        <div className="flex-1">
                          <div className="flex justify-between mb-1.5">
                            <span className="text-sm text-[#888888]">Mood {m.label}</span>
                            <span className="text-xs text-[#444444]">{m.n} trades</span>
                          </div>
                          <MiniBar value={m.wr} max={100} color={m.color} height={4} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            </div>
      )}

      {/* ════════════ FINAL BOSS TAB ══════════════════════════════════════════ */}
      {tab === "boss" && (
        !gate
          ? (
            <div style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 8, padding: "40px 32px", maxWidth: 420, margin: "32px auto", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>👑</div>
              <div style={{ color: "#C9A84C", fontWeight: 800, fontSize: 18, marginBottom: 8, letterSpacing: "0.04em" }}>Final Boss — Locked</div>
              <p style={{ color: "#444", fontSize: 13, lineHeight: 1.7, marginBottom: 32 }}>
                A mentor doesn't speak until they've seen enough to say something true.
              </p>
              <div style={{ textAlign: "left" }}>
                <GBar label="Backtests required"   n={bt.length}   req={GATE_BACKTEST} />
                <GBar label="Live trades required" n={live.length} req={GATE_LIVE} />
              </div>
            </div>
          )
          : (
            <div className="space-y-4">

              {/* ── CINEMATIC HEADER ── */}
              <div style={{ background: "#0A0A0A", border: `1px solid ${bossStatusColor}55`, borderRadius: 8, padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #1A1A1A" }}>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>👑 Final Boss Report</div>
                    <div style={{ fontSize: 38, fontWeight: 900, color: "#C9A84C", letterSpacing: "-0.01em", lineHeight: 1 }}>THE VERDICT</div>
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase",
                    padding: "6px 14px", borderRadius: 5,
                    border: `1px solid ${bossStatusColor}55`,
                    background: `${bossStatusColor}15`,
                    color: bossStatusColor
                  }}>{bossStatus}</div>
                </div>

                {/* 4 hero stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <BossStatCard label="Live Win Rate"     value={`${lv.wr.toFixed(1)}%`}                   color={lv.wr >= 50 ? "#3DAA6A" : "#CC4444"} sub={`${live.length} trades`} />
                  <BossStatCard label="Pip Expectancy"    value={`${lv.exp > 0 ? "+" : ""}${lv.exp.toFixed(1)}`} color={lv.exp > 0 ? "#3DAA6A" : "#CC4444"} sub="pips per trade" />
                  <BossStatCard label="Net P&L"           value={`${lv.pnl >= 0 ? "+" : "−"}$${Math.abs(lv.pnl).toFixed(0)}`} color={lv.pnl >= 0 ? "#3DAA6A" : "#CC4444"} sub="live account" />
                  <BossStatCard label="Avg R:R (live)"    value={lv.avgRR.toFixed(2)}                       color={lv.avgRR >= 1 ? "#C9A84C" : "#CC4444"} sub={`target ≥ 2.0`} />
                </div>
              </div>

              {/* ── EXECUTION GAP ── */}
              <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9A84C", fontWeight: 700, marginBottom: 16 }}>Execution Gap — Backtest vs Live</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {[
                    { label: "Backtest WR",  value: `${bv.wr.toFixed(1)}%`,       color: bv.wr >= 50 ? "#3DAA6A" : "#CC4444" },
                    { label: "Live WR",      value: `${lv.wr.toFixed(1)}%`,       color: lv.wr >= 50 ? "#3DAA6A" : "#CC4444" },
                    { label: "Backtest RR",  value: bv.avgRR.toFixed(2),          color: "#C9A84C" },
                    { label: "Live RR",      value: lv.avgRR.toFixed(2),          color: lv.avgRR >= 1 ? "#C9A84C" : "#CC4444" },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#444", marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <BossGapBar liveWR={lv.wr} btWR={bv.wr} />
                <div style={{ marginTop: 14, padding: "10px 14px", background: wrGap > 10 ? "#1A0500" : "#051A05", border: `1px solid ${wrGap > 10 ? "#CC444433" : "#3DAA6A33"}`, borderRadius: 5 }}>
                  <span style={{ fontSize: 12, color: wrGap > 10 ? "#CC4444" : "#3DAA6A", fontWeight: 700 }}>
                    {wrGap > 20 ? `⚠ ${wrGap.toFixed(1)}pp gap — strategy works in backtest, not live. This is a psychology problem.`
                      : wrGap > 10 ? `↑ ${wrGap.toFixed(1)}pp gap — closing, but live execution still lagging.`
                      : wrGap > 0  ? `↑ ${wrGap.toFixed(1)}pp difference — small and within normal variance.`
                      : `✓ Live matches or exceeds backtest. You are executing your edge.`}
                  </span>
                </div>
              </div>

              {/* ── GRADE BREAKDOWN ── */}
              <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9A84C", fontWeight: 700, marginBottom: 4 }}>Grade Breakdown — Live vs Backtest</div>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>Your highest-grade trades should have the highest win rate. If they don't, you're either misgrading setups or failing on execution.</div>
                {["A+", "A", "B"].map(g => (
                  <BossGradeRow key={g} grade={g} data={lvG} btData={btG} />
                ))}
              </div>

              {/* ── SESSION BREAKDOWN ── */}
              {lvS.length > 0 && (
                <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 8, padding: "20px 24px" }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9A84C", fontWeight: 700, marginBottom: 16 }}>Session Performance</div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(lvS.length, 3)}, 1fr)`, gap: 12 }}>
                    {lvS.map(s => (
                      <div key={s.name} style={{ padding: "14px 16px", border: "1px solid #1A1A1A", borderRadius: 6, textAlign: "center" }}>
                        <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#444", marginBottom: 8 }}>{s.name}</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: s.wr >= 50 ? "#3DAA6A" : "#CC4444", lineHeight: 1, marginBottom: 6 }}>{s.wr.toFixed(0)}%</div>
                        <div style={{ fontSize: 10, color: "#444" }}>{s.n} trades · RR {s.avgRR}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4, color: s.pnl >= 0 ? "#3DAA6A" : "#CC4444" }}>{s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── PSYCHOLOGY DIAGNOSIS ── */}
              <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9A84C", fontWeight: 700, marginBottom: 4 }}>Psychology Diagnosis</div>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>What's happening between the chart and your mouse click.</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                  <div style={{ padding: "12px 14px", background: "#0A1800", border: "1px solid #3DAA6A33", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#3DAA6A88", marginBottom: 6 }}>Stable</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: "#3DAA6A", lineHeight: 1 }}>{stableCount}</div>
                    <div style={{ fontSize: 10, color: "#3DAA6A66", marginTop: 4 }}>{live.length > 0 ? `${((stableCount / live.length) * 100).toFixed(0)}% of trades` : "—"}</div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#1A0500", border: "1px solid #CC444433", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#CC444488", marginBottom: 6 }}>Wrong side</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: wrongSide > 0 ? "#CC4444" : "#444", lineHeight: 1 }}>{wrongSide}</div>
                    <div style={{ fontSize: 10, color: "#CC444466", marginTop: 4 }}>{live.length > 0 ? `${((wrongSide / live.length) * 100).toFixed(0)}% of trades` : "—"}</div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#1A0A00", border: "1px solid #C9A84C33", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#C9A84C88", marginBottom: 6 }}>FOMO</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: fomoCount > 0 ? "#C9A84C" : "#444", lineHeight: 1 }}>{fomoCount}</div>
                    <div style={{ fontSize: 10, color: "#C9A84C66", marginTop: 4 }}>{live.length > 0 ? `${((fomoCount / live.length) * 100).toFixed(0)}% of trades` : "—"}</div>
                  </div>
                </div>

                {Object.entries(lvPsy).sort((a, b) => b[1] - a[1]).map(([tag, count]) => (
                  <BossPsychRow
                    key={tag}
                    tag={tag}
                    count={count}
                    total={psychTotal}
                    isPositive={tag === "STABLE"}
                  />
                ))}

                {lvPat.length === 0 && (
                  <div style={{ marginTop: 16, padding: "10px 14px", background: "#1A1A00", border: "1px solid #886600", borderRadius: 5, fontSize: 12, color: "#886600", fontWeight: 700 }}>
                    ⚠ No confirmed patterns yet — need {PATTERN_MIN}+ trades in same session+grade combination before anything is statistically real.
                  </div>
                )}
              </div>

              {/* ── AI REPORT ── */}
              {aiLoading && (
                <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 8, padding: "48px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 16 }} className="animate-pulse">👑</div>
                  <div style={{ color: "#C9A84C", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Reading your data...</div>
                  <div style={{ color: "#333", fontSize: 12 }}>Live · Backtest · Psychology · Patterns · Gap</div>
                </div>
              )}

              {!aiLoading && aiReport && (
                <div style={{ background: "#0D0D0D", border: "1px solid #C9A84C44", borderRadius: 8, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #1A1A1A" }}>
                    <span style={{ fontSize: 18 }}>👑</span>
                    <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9A84C", fontWeight: 700 }}>AI Mentor Analysis</div>
                  </div>
                  <BossAIReport text={aiReport} />
                </div>
              )}

              {!aiLoading && !aiReport && (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>👑</div>
                  <p style={{ color: "#444", fontSize: 13, marginBottom: 20 }}>Gate is open. Data is loaded. Ready when you are.</p>
                  <button onClick={runBoss}
                    style={{ padding: "12px 28px", background: "#C9A84C", color: "#0D0D0D", borderRadius: 6, fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", letterSpacing: "0.05em" }}>
                    👑 Run Final Boss Analysis
                  </button>
                </div>
              )}

            </div>
          )
      )}
    </div>
  )
}
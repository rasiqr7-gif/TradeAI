import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { computeGrade, buildAiReasoningPrompt, getScenarioOptions } from "../utils/GradeUtils"

const API = "http://localhost:3001"
const MAX_SS = 5

const POI_OPTIONS = ["FVG", "BB", "OB", "IFVG", "LIQ SWEEP", "MB"]
const EXECUTION_REVIEW_OPTIONS = [
  "STABLE", "FOGS", "FEAR", "GREED", "FOMO",
  "Wrong side of probability", "Method mistake", "Psychological mistake"
]
const SESSION_OPTIONS = ["LONDON", "NY AM", "NY PM", "OUT OF SESSION"]

const GRADES = {
  "A+": { color: "#C9A84C", bg: "#1A1500", label: "A+ SETUP", risk: "default_risk_aplus" },
  "A":  { color: "#3DAA6A", bg: "#0A1A0A", label: "A SETUP",  risk: "default_risk_a" },
  "B":  { color: "#886600", bg: "#1A1000", label: "B SETUP",  risk: "default_risk_b" },
  "No Trade": { color: "#CC4444", bg: "#1A0A0A", label: "NO TRADE", risk: null }
}

// ── DECISION TREE — identical to Checklist.jsx ───────────────────────────────
const DECISION_TREE = [
  {
    id: "news",
    question: "Is there any high impact news scheduled during this session?",
    hint: "Check Forex Factory right now. Red folder events only.",
    type: "single",
    hardStop: true,
    options: [
      { label: "No news — clear",         value: "clear", safe: true  },
      { label: "News scheduled — STOP",   value: "news",  safe: false },
    ],
  },
  {
    id: "bias",
    question: "What did the previous daily candle close do?",
    hint: "Look at yesterday's daily candle close relative to the day before it.",
    type: "single",
    hardStop: true,
    options: [
      { label: "Closed ABOVE Previous Day High → Bullish",              value: "bullish_above", safe: true,  bias: "BULLISH" },
      { label: "Closed BELOW Previous Day Low → Bearish",               value: "bearish_below", safe: true,  bias: "BEARISH" },
      { label: "Took PDH, failed to close above → Bearish",             value: "bearish_fail",  safe: true,  bias: "BEARISH" },
      { label: "Took PDL, failed to close below → Bullish",             value: "bullish_fail",  safe: true,  bias: "BULLISH" },
      { label: "Took both, closed above PDH → Bullish",                 value: "both_bullish",  safe: true,  bias: "BULLISH" },
      { label: "Took both, closed below PDL → Bearish",                 value: "both_bearish",  safe: true,  bias: "BEARISH" },
      { label: "Took both / Took none — closed inside range → No bias", value: "inside",        safe: true,  bias: null      },
    ],
  },
  {
    id: "prev_bias",
    question: "What was YESTERDAY'S bias — the day before today's no-bias candle?",
    hint: "Look at the daily candle from two days ago relative to three days ago. Same PDH/PDL rules apply.",
    type: "prev_bias",
    hardStop: true,
    showIf: "inside",
    options: [
      { label: "Yesterday was Bullish",                  value: "no_bias_prev_bullish", safe: true  },
      { label: "Yesterday was Bearish",                  value: "no_bias_prev_bearish", safe: true  },
      { label: "Yesterday was also no bias — hard stop", value: "no_prev_bias",         safe: false },
    ],
  },
  {
    id: "scenario",
    question: "How did price open today and what is it doing?",
    hint: "Compare today's open to PDH, PDL and EQ on the hourly chart.",
    type: "scenario",
    hardStop: true,
  },
  {
    id: "poi_zone",
    question: "Where exactly is your POI sitting on the Fibonacci of the impulse leg?",
    hint: "Draw Fib from the base of the impulse leg to its end. Where is your FVG/OB/BB?",
    type: "single",
    hardStop: false,
    options: [
      { label: "Inside 0.62 to 0.79 — Golden Zone ✓",         value: "golden",   probability: "high"   },
      { label: "At 0.50 — permissible but lower probability",  value: "at_50",    probability: "medium" },
      { label: "Above 0.50 — trap zone, do not enter",         value: "above_50", probability: "none",  safe: false },
    ],
  },
  {
    id: "liquidity",
    question: "Is there uncleared liquidity sitting above your SL?",
    hint: "If there is uncleared liquidity above your SL then price is more likely to hit your SL and clear that liquidity before moving in your direction.",
    type: "single",
    hardStop: false,
    options: [
      { label: "No uncleared liquidity above SL — clean ✓",                                           value: "clean",        probability: "high"   },
      { label: "Liquidity exists above SL but strong OB with trend justifies the entry — lower prob", value: "ob_justifies", probability: "medium" },
      { label: "Liquidity exists above SL with no justification — do not enter",                       value: "liq_block",    probability: "none",  safe: false },
    ],
  },
  {
    id: "opposing_fvg",
    question: "Is there an opposing FVG between your entry and your target?",
    hint: "Check from 1H down to 5M. If the 1H FVG is being respected, the answer is respected — regardless of lower timeframe closes.",
    type: "single",
    hardStop: false,
    options: [
      { label: "No opposing FVG — path is clear ✓",                          value: "none",         probability: "high" },
      { label: "Opposing FVG present but disrespected by candle close ✓",     value: "disrespected", probability: "high" },
      { label: "Opposing FVG present and being respected — do not enter",     value: "respected",    probability: "none", safe: false },
    ],
  },
  {
    id: "crt",
    question: "Has the 1H CRT confirmed at your POI?",
    hint: "On the 1H chart: did the candle sweep liquidity AND close back inside the range with only the wick outside?",
    type: "single",
    hardStop: true,
    options: [
      { label: "Yes — liquidity swept and candle closed back inside range ✓", value: "confirmed", safe: true  },
      { label: "Swept but candle did not close back inside — not confirmed",   value: "no_close",  safe: false },
      { label: "Not yet formed — wait",                                        value: "not_yet",   safe: false },
    ],
  },
  {
    id: "cisd",
    question: "Has the 3M CISD confirmed aligned with the 1H CRT?",
    hint: "On 3M: did price close beyond the opening of the leg that swept liquidity? Must align with 1H CRT close.",
    type: "single",
    hardStop: true,
    options: [
      { label: "Yes — price closed beyond the opening of the swept leg ✓", value: "confirmed", safe: true  },
      { label: "No — not confirmed yet",                                    value: "not_yet",   safe: false },
    ],
  },
  {
    id: "rr",
    question: "What is your planned Risk to Reward?",
    hint: "Measure from your entry to SL (risk) and entry to PDH/PDL (reward). Enter the ratio.",
    type: "rr_input",
    hardStop: true,
  },
  {
    id: "liq_strength",
    question: "How strong is the liquidity at your target?",
    hint: "Is the PDH/PDL a major external level with real pulling power, or just a minor internal level?",
    type: "liq_strength",
    hardStop: false,
    options: [
      { label: "Strong external liquidity — PDH/PDL, clean untouched level ✓", value: "strong",   probability: "high"   },
      { label: "Internal liquidity — weaker, less magnetic",                    value: "internal", probability: "medium" },
      { label: "No clear liquidity at target — TP has no anchor",              value: "none",     probability: "none",  safe: false },
    ],
  },
]

// ── HARD STOP MESSAGES ────────────────────────────────────────────────────────
const HARD_STOP_MESSAGES = {
  news:         { title: "NEWS EVENT ACTIVE",       body: "High impact news destroys setups. The market is not yours to trade right now." },
  bias:         { title: "NO BIAS",                 body: "Previous candle closed inside range. No directional conviction. Stand aside until a close confirms direction." },
  prev_bias:    { title: "NO PREVIOUS BIAS",        body: "Yesterday was also a no-bias day. Two consecutive no-bias days means there is no directional foundation to trade from. Stand aside." },
  scenario:     { title: "NO VALID SCENARIO",       body: "Price behavior does not match your trade direction. Do not force a trade." },
  poi_zone:     { title: "POI ABOVE 0.50 — TRAP",  body: "Entering above 0.50 Fib means you will be stopped out before the real move. Price will fake a reaction, sweep you, then go." },
  liquidity:    { title: "UNCLEARED LIQUIDITY",     body: "Liquidity above your entry will be swept before price continues. You will be the liquidity. Wait for it to clear first." },
  opposing_fvg: { title: "OPPOSING FVG RESPECTED",  body: "That FVG in your path will turn price back into your entry and stop you out. Walk away." },
  crt:          { title: "1H CRT NOT CONFIRMED",    body: "No candle closed back inside range. The setup has not triggered yet. Wait or move on." },
  cisd:         { title: "3M CISD NOT CONFIRMED",   body: "No structural shift on the 3M. Entry without this is gambling, not trading." },
  rr_low:       { title: "RR BELOW 2 — NO TRADE",  body: "Below 2R the math does not work. Your winrate cannot sustain this. No exceptions." },
  liq_strength: { title: "NO TARGET LIQUIDITY",     body: "Your TP has no anchor. Price needs a reason to travel to your target. This setup has none." },
}

function calcPnl(pips, lot) { return (parseFloat(pips) || 0) * (parseFloat(lot) || 0) * 10 }
function getRiskAmount(grade, settings) {
  const size = settings?.account_size || 5000
  if (grade === "A+") return (size * (settings?.default_risk_aplus || 1)) / 100
  if (grade === "A")  return (size * (settings?.default_risk_a     || 0.75)) / 100
  if (grade === "B")  return (size * (settings?.default_risk_b     || 0.5)) / 100
  return 0
}
function parsePaths(val) {
  if (!val) return []
  try { const a = JSON.parse(val); if (Array.isArray(a)) return a } catch {}
  return val.split(",").filter(Boolean).map(s => s.trim())
}

// ── SHARED UI ─────────────────────────────────────────────────────────────────
function MultiSelect({ options, value = [], onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt} onClick={() => {
          const n = value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]
          onChange(n)
        }} className={`px-3 py-1.5 rounded text-sm font-bold transition-all border ${
          value.includes(opt)
            ? "bg-[#C9A84C] border-[#C9A84C] text-[#0D0D0D]"
            : "bg-[#0D0D0D] border-[#333333] text-[#555555] hover:border-[#C9A84C]"
        }`}>{opt}</button>
      ))}
    </div>
  )
}

function ScreenshotGallery({ paths }) {
  const [zoom, setZoom] = useState(null)
  if (!paths || paths.length === 0) return (
    <div className="bg-[#0D0D0D] border border-[#222222] rounded p-6 text-center text-[#444444] text-sm">No screenshots attached</div>
  )
  return (
    <>
      {zoom !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[9999] cursor-zoom-out"
          onClick={() => setZoom(null)}>
          <img src={`${API}/screenshots/${paths[zoom]}`} alt="ss"
            className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
          {paths.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); setZoom((zoom - 1 + paths.length) % paths.length) }}
                className="absolute left-4 text-white text-3xl bg-black bg-opacity-50 px-3 py-1 rounded">◀</button>
              <button onClick={e => { e.stopPropagation(); setZoom((zoom + 1) % paths.length) }}
                className="absolute right-4 text-white text-3xl bg-black bg-opacity-50 px-3 py-1 rounded">▶</button>
              <div className="absolute bottom-4 text-white text-sm">{zoom + 1} / {paths.length}</div>
            </>
          )}
        </div>
      )}
      <div className={`grid gap-2 ${paths.length === 1 ? "grid-cols-1" : paths.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {paths.map((p, i) => (
          <img key={i} src={`${API}/screenshots/${p}`} alt={`ss-${i + 1}`}
            className="w-full rounded border border-[#222222] cursor-zoom-in object-cover"
            style={{ maxHeight: "180px" }} onClick={() => setZoom(i)} />
        ))}
      </div>
      {paths.length > 1 && <p className="text-[#444444] text-xs mt-1 text-center">Click to fullscreen · Arrows to navigate</p>}
    </>
  )
}

// ── HARD STOP SCREEN ──────────────────────────────────────────────────────────
function HardStopScreen({ question, answer, onReset }) {
  const content = HARD_STOP_MESSAGES[question] || { title: "CONDITION FAILED", body: "This setup does not meet your strategy rules." }
  return (
    <div className="flex items-center justify-center min-h-full p-6">
      <div className="w-full max-w-md text-center">
        <div className="text-6xl mb-6">⛔</div>
        <div className="bg-[#1A0A0A] border-2 border-[#CC4444] rounded p-6 mb-6">
          <h2 className="text-[#CC4444] text-xl font-bold mb-3">{content.title}</h2>
          <p className="text-[#884444] text-sm leading-relaxed">{content.body}</p>
          {answer && (
            <div className="mt-4 pt-4 border-t border-[#330000]">
              <p className="text-[#555555] text-xs">Your answer: <span className="text-[#CC4444]">{answer}</span></p>
            </div>
          )}
        </div>
        <p className="text-[#444444] text-xs mb-6">A missed backtest is fine. A sloppy graded one poisons your data.</p>
        <button onClick={onReset}
          className="w-full py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#666666] hover:text-[#999999]">
          ← Start Over
        </button>
      </div>
    </div>
  )
}

// ── ANSWER SUMMARY ────────────────────────────────────────────────────────────
function AnswerSummary({ answers, rrValue, liqStrength, onConfirm, onReset }) {
  const labels = {
    session: "Session", news: "News Check", bias: "Daily Bias",
    prev_bias: "Yesterday's Bias", scenario: "Day Scenario",
    poi_zone: "POI Fibonacci Zone", liquidity: "Path Liquidity",
    opposing_fvg: "Opposing FVG", crt: "1H CRT", cisd: "3M CISD",
    rr: "Planned RR", liq_strength: "Target Liquidity",
  }
  return (
    <div className="p-6 max-w-xl">
      <h3 className="text-[#C9A84C] text-lg font-bold mb-1">Review Your Answers</h3>
      <p className="text-[#444444] text-xs mb-5">Confirm everything is what you actually saw on the chart — BEFORE the outcome.</p>
      <div className="bg-[#111111] border border-[#222222] rounded overflow-hidden mb-5">
        {Object.entries(answers).map(([key, val], i) => (
          <div key={key} className={`flex justify-between items-start px-4 py-3 ${i < Object.keys(answers).length - 1 ? "border-b border-[#1A1A1A]" : ""}`}>
            <span className="text-[#555555] text-xs uppercase tracking-wider">{labels[key] || key}</span>
            <span className="text-[#CCCCCC] text-xs text-right max-w-xs">{val}</span>
          </div>
        ))}
        <div className="flex justify-between items-start px-4 py-3 border-t border-[#1A1A1A]">
          <span className="text-[#555555] text-xs uppercase tracking-wider">Planned RR</span>
          <span className="text-[#C9A84C] text-xs font-bold">{rrValue}R</span>
        </div>
        <div className="flex justify-between items-start px-4 py-3 border-t border-[#1A1A1A]">
          <span className="text-[#555555] text-xs uppercase tracking-wider">Target Liquidity</span>
          <span className="text-[#CCCCCC] text-xs">{liqStrength}</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onReset} className="flex-1 py-3 rounded text-sm text-[#666666] border border-[#333333] hover:bg-[#1A1A1A]">
          Start Over
        </button>
        <button onClick={onConfirm} className="flex-1 py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
          Confirm — Grade This Setup →
        </button>
      </div>
    </div>
  )
}

// ── BACKTEST CHECKLIST (full decision tree) ───────────────────────────────────
function BacktestChecklist({ settings, onComplete, onCancel }) {

  const [pair, setPair]           = useState("")
  const [direction, setDirection] = useState("")
  const [session, setSession]     = useState("")

  const [treePhase, setTreePhase]           = useState("setup")
  const [currentStep, setCurrentStep]       = useState(0)
  const [treeAnswers, setTreeAnswers]       = useState({})
  const [treeValues, setTreeValues]         = useState({})
  const [hardStopped, setHardStopped]       = useState(null)
  const [hardStopAnswer, setHardStopAnswer] = useState("")
  const [rrInput, setRrInput]               = useState("")
  const [rrError, setRrError]               = useState("")
  const [showSummary, setShowSummary]       = useState(false)

  const [result, setResult]               = useState(null)
  const [slPipsInput, setSlPipsInput]     = useState("")
  const [wouldTakeLive, setWouldTakeLive] = useState(null)
  const [hindsightBias, setHindsightBias] = useState(null)

  function resetTree() {
    setCurrentStep(0); setTreeAnswers({}); setTreeValues({})
    setHardStopped(null); setHardStopAnswer(""); setRrInput("")
    setRrError(""); setShowSummary(false)
  }

  function getScenarioOpts() {
    return getScenarioOptions(direction, treeValues.bias || "", treeValues.prev_bias || "")
  }

  function getNodeOptions(node) {
    if (node.id === "scenario") return getScenarioOpts()
    return node.options || []
  }

  // find next valid step — skips prev_bias when bias is not no-bias
  function getNextStep(fromStep, currentValues) {
    let next = fromStep + 1
    while (next < DECISION_TREE.length) {
      const node = DECISION_TREE[next]
      if (node.id === "prev_bias" && currentValues.bias !== "inside" && currentValues.bias !== "took_none") {
        next++
      } else {
        break
      }
    }
    return next
  }

  function handleOption(node, option) {
    const newAnswers = { ...treeAnswers, [node.id]: option.label }
    const newValues  = { ...treeValues,  [node.id]: option.value }

    if ((node.hardStop && option.safe === false) || option.probability === "none" || option.safe === false) {
      setTreeAnswers(newAnswers); setTreeValues(newValues)
      setHardStopped(node.id); setHardStopAnswer(option.label); return
    }

    setTreeAnswers(newAnswers); setTreeValues(newValues)

    const nextStep = getNextStep(currentStep, newValues)
    if (nextStep < DECISION_TREE.length) setCurrentStep(nextStep)
    else setShowSummary(true)
  }

  function handleRrSubmit() {
    const rr = parseFloat(rrInput)
    if (!rrInput || isNaN(rr)) { setRrError("Enter a valid RR number"); return }
    if (rr < 2) {
      setTreeAnswers({ ...treeAnswers, rr: `${rrInput}R — Below minimum` })
      setTreeValues({ ...treeValues, rr: rrInput })
      setHardStopped("rr_low"); setHardStopAnswer(`${rrInput}R`); return
    }
    setTreeAnswers({ ...treeAnswers, rr: `${rrInput}R` })
    setTreeValues({ ...treeValues, rr: rrInput })
    setRrError("")
    const nextStep = getNextStep(currentStep, { ...treeValues, rr: rrInput })
    if (nextStep < DECISION_TREE.length) setCurrentStep(nextStep)
    else setShowSummary(true)
  }

  function handleLiqStrength(option) {
    const newAnswers = { ...treeAnswers, liq_strength: option.label }
    const newValues  = { ...treeValues,  liq_strength: option.value }
    if (option.safe === false || option.probability === "none") {
      setTreeAnswers(newAnswers); setTreeValues(newValues)
      setHardStopped("liq_strength"); setHardStopAnswer(option.label); return
    }
    setTreeAnswers(newAnswers); setTreeValues(newValues)
    setShowSummary(true)
  }

  async function gradeSetup() {
    setShowSummary(false); setTreePhase("grading")
    try {
      const { grade, ceiling, warnings, filters } = computeGrade(treeValues, direction, 10)

      const { system, prompt } = buildAiReasoningPrompt({
        grade, treeAnswers, direction, pair, session,
        rr: treeValues.rr, warnings, filters, isBacktest: true,
      })

      let gradeResult
      try {
        const response  = await axios.post(`${API}/api/ai`, { system, prompt })
        const text      = response.data.response
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        const parsed    = JSON.parse(jsonMatch ? jsonMatch[0] : text)
        gradeResult = { ...parsed, grade, warnings }
      } catch {
        gradeResult = {
          grade, warnings,
          reasoning:       `This backtest setup is graded ${grade} based on filter results.`,
          risk_suggestion: "Use your standard risk for this grade.",
          strengths:       [],
        }
      }
      setResult(gradeResult); setTreePhase("result")
    } catch (e) { console.error(e); setTreePhase("result") }
  }

  function handleUseGrade() {
    if (wouldTakeLive === null || hindsightBias === null) { alert("Answer both integrity flags"); return }
    const gradeInfo    = GRADES[result.grade] || GRADES["B"]
    const riskPct      = result.grade !== "No Trade" ? (settings?.[gradeInfo.risk] || 1) : 0
    const accountSize  = settings?.account_size || 5000
    const riskAmount   = (accountSize * riskPct) / 100
    const sl           = parseFloat(slPipsInput) || 0
    const suggestedLot = sl > 0 ? (riskAmount / (sl * 10)).toFixed(2) : ""

    const BULLISH_BIAS_VALUES = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
    const detectedBias =
      BULLISH_BIAS_VALUES.includes(treeValues.bias) || BULLISH_BIAS_VALUES.includes(treeValues.prev_bias)
        ? "BULLISH" : "BEARISH"

    onComplete({
      grade:         result.grade,
      lotSize:       suggestedLot,
      slPips:        slPipsInput,
      plannedRr:     treeValues.rr || "",
      wouldTakeLive,
      hindsightBias,
      pair,
      direction,
      session,
      bias:          detectedBias,
    })
  }

  // ── SETUP PHASE ──
  if (treePhase === "setup") return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111111] border border-[#C9A84C] rounded w-full max-w-lg">
        <div className="flex justify-between items-center p-5 border-b border-[#222222]">
          <div>
            <h3 className="text-[#C9A84C] font-bold text-lg">Pre-Backtest Checklist</h3>
            <p className="text-[#444444] text-xs mt-1">Grade BEFORE entering the result. No hindsight.</p>
          </div>
          <button onClick={onCancel} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Pair</label>
            <div className="flex gap-2">
              {["EURUSD", "XAUUSD"].map(p => (
                <button key={p} onClick={() => setPair(p)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${pair === p ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#555555]"}`}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Direction</label>
            <div className="flex gap-2">
              {["BUY", "SELL"].map(d => (
                <button key={d} onClick={() => setDirection(d)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${direction === d ? d === "BUY" ? "bg-[#3DAA6A] text-white" : "bg-[#CC4444] text-white" : "bg-[#1A1A1A] text-[#555555]"}`}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Session</label>
            <div className="flex gap-2 flex-wrap">
              {SESSION_OPTIONS.map(s => (
                <button key={s} onClick={() => setSession(s)}
                  className={`px-4 py-2 rounded text-sm font-bold ${session === s ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#555555]"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="bg-[#0D0D0D] border border-[#333333] rounded p-3">
            <p className="text-[#886600] text-xs font-bold mb-1">⚠ BACKTEST DISCIPLINE RULE</p>
            <p className="text-[#555555] text-xs">Answer all questions BEFORE looking at the candle close. Hindsight bias poisons your statistics.</p>
          </div>
        </div>
        <div className="p-5 border-t border-[#222222]">
          <button onClick={() => {
            if (!pair || !direction || !session) { alert("Select pair, direction and session"); return }
            resetTree(); setTreePhase("interview")
          }} className="w-full py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
            START SETUP ANALYSIS →
          </button>
        </div>
      </div>
    </div>
  )

  // ── HARD STOP ──
  if (treePhase === "interview" && hardStopped) return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md">
        <HardStopScreen question={hardStopped} answer={hardStopAnswer} onReset={() => { resetTree(); setTreePhase("setup") }} />
      </div>
    </div>
  )

  // ── SUMMARY ──
  if (treePhase === "interview" && showSummary) return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-[#111111] border border-[#333333] rounded">
        <AnswerSummary
          answers={treeAnswers}
          rrValue={treeValues.rr}
          liqStrength={treeAnswers.liq_strength}
          onConfirm={gradeSetup}
          onReset={() => { resetTree(); setTreePhase("setup") }}
        />
      </div>
    </div>
  )

  // ── INTERVIEW — DECISION TREE ──
  if (treePhase === "interview") {
    const node     = DECISION_TREE[currentStep]
    const options  = getNodeOptions(node)
    const progress = (currentStep / DECISION_TREE.length) * 100

    const isNoBias        = treeValues.bias === "inside" || treeValues.bias === "took_none"
    const BULLISH_BIAS_V  = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
    const effectiveBias   = isNoBias ? (treeValues.prev_bias || "") : treeValues.bias
    const biasDir         = BULLISH_BIAS_V.includes(effectiveBias) ? "BULLISH" : "BEARISH"
    const biasMatched     = (direction === "BUY" && biasDir === "BULLISH") || (direction === "SELL" && biasDir === "BEARISH")

    return (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-xl">
          <div className="flex justify-between items-center mb-6">
            <span className="text-[#444444] text-xs">{pair} {direction} — {session} — BACKTEST</span>
            <button onClick={() => { resetTree(); setTreePhase("setup") }}
              className="w-8 h-8 flex items-center justify-center rounded text-[#444444] hover:text-[#CC4444] hover:bg-[#1A0A0A] transition-all text-lg font-bold border border-[#222222]">✕</button>
          </div>

          <div className="mb-6">
            <div className="flex justify-between text-xs text-[#444444] mb-2">
              <span>Step {currentStep + 1} of {DECISION_TREE.length}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <div className="h-1 bg-[#1A1A1A] rounded overflow-hidden">
              <div className="h-full bg-[#C9A84C] rounded transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="bg-[#111111] border border-[#222222] rounded p-6 mb-5">
            <h3 className="text-[#F0EDE8] text-lg font-bold leading-relaxed mb-3">{node.question}</h3>
            {node.hint && (
              <p className="text-[#444444] text-xs leading-relaxed border-t border-[#1A1A1A] pt-3">💡 {node.hint}</p>
            )}

            {/* No-bias context banner */}
            {node.id === "prev_bias" && (
              <div className="mt-3 pt-3 border-t border-[#1A1A1A]">
                <p className="text-[#C9A84C] text-xs font-bold">⚠ No bias today — yesterday's bias becomes the operative direction. Max grade B on all paths.</p>
              </div>
            )}

            {/* Scenario bias context */}
            {node.id === "scenario" && treeValues.bias && (
              <div className="mt-3 pt-3 border-t border-[#1A1A1A]">
                {isNoBias
                  ? <p className="text-[#C9A84C] text-xs font-bold">⚠ No bias today — operating on yesterday's {biasDir} bias. Max grade B.</p>
                  : biasMatched
                  ? <p className="text-[#3DAA6A] text-xs font-bold">✓ Direction matches bias — only bias-aligned scenarios shown</p>
                  : <p className="text-[#C9A84C] text-xs font-bold">⚠ Going against bias — only reversal scenarios justify this trade</p>
                }
              </div>
            )}
          </div>

          {/* RR INPUT */}
          {node.type === "rr_input" && (
            <div className="space-y-3">
              <div className="bg-[#111111] border border-[#333333] rounded p-4">
                <div className="flex gap-3 items-center">
                  <input type="number" step="0.1" min="0" placeholder="e.g. 2.5" value={rrInput}
                    onChange={e => { setRrInput(e.target.value); setRrError("") }}
                    onKeyDown={e => e.key === "Enter" && handleRrSubmit()}
                    className="flex-1 bg-[#0D0D0D] border border-[#333333] rounded px-4 py-3 text-[#CCCCCC] text-xl font-bold focus:outline-none focus:border-[#C9A84C] text-center"
                    autoFocus />
                  <span className="text-[#C9A84C] text-xl font-bold">R</span>
                </div>
                {rrError && <p className="text-[#CC4444] text-xs mt-2">{rrError}</p>}
                {rrInput && !isNaN(parseFloat(rrInput)) && (
                  <div className="mt-3 pt-3 border-t border-[#1A1A1A]">
                    {parseFloat(rrInput) < 2   && <p className="text-[#CC4444] text-xs">⛔ Below 2R — this will be a hard stop</p>}
                    {parseFloat(rrInput) >= 2   && parseFloat(rrInput) < 2.5 && <p className="text-[#886600] text-xs">⚠ 2R to 2.4R — only valid on full confluence A+ setup</p>}
                    {parseFloat(rrInput) >= 2.5 && parseFloat(rrInput) < 3   && <p className="text-[#3DAA6A] text-xs">✓ Standard RR — valid for A and A+ setups</p>}
                    {parseFloat(rrInput) >= 3   && <p className="text-[#C9A84C] text-xs">✓ High RR — consider partial close at first target</p>}
                  </div>
                )}
              </div>
              <button onClick={handleRrSubmit}
                className="w-full py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
                Confirm RR →
              </button>
            </div>
          )}

          {/* LIQ STRENGTH */}
          {node.type === "liq_strength" && (
            <div className="space-y-2">
              {node.options.map((option, i) => (
                <button key={i} onClick={() => handleLiqStrength(option)}
                  className={`w-full text-left px-4 py-4 rounded border transition-all ${
                    option.safe === false || option.probability === "none"
                      ? "bg-[#0D0D0D] border-[#CC4444] text-[#CC4444] hover:bg-[#1A0A0A]"
                      : option.probability === "medium"
                      ? "bg-[#0D0D0D] border-[#886600] text-[#886600] hover:bg-[#1A1000]"
                      : "bg-[#0D0D0D] border-[#333333] text-[#CCCCCC] hover:border-[#C9A84C] hover:bg-[#1A1500]"
                  }`}>
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* PREV BIAS */}
          {node.type === "prev_bias" && (
            <div className="space-y-2">
              {node.options.map((option, i) => (
                <button key={i} onClick={() => handleOption(node, option)}
                  className={`w-full text-left px-4 py-4 rounded border transition-all ${
                    option.safe === false
                      ? "bg-[#0D0D0D] border-[#CC4444] text-[#CC4444] hover:bg-[#1A0A0A]"
                      : "bg-[#0D0D0D] border-[#333333] text-[#CCCCCC] hover:border-[#C9A84C] hover:bg-[#1A1500]"
                  }`}>
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* SINGLE / SCENARIO SELECT */}
          {(node.type === "single" || node.type === "scenario") && (
            <div className="space-y-2">
              {options.map((option, i) => (
                <button key={i} onClick={() => handleOption(node, option)}
                  className={`w-full text-left px-4 py-4 rounded border transition-all ${
                    option.safe === false || option.probability === "none"
                      ? "bg-[#0D0D0D] border-[#CC4444] text-[#CC4444] hover:bg-[#1A0A0A]"
                      : option.probability === "medium"
                      ? "bg-[#0D0D0D] border-[#886600] text-[#886600] hover:bg-[#1A1000]"
                      : "bg-[#0D0D0D] border-[#333333] text-[#CCCCCC] hover:border-[#C9A84C] hover:bg-[#1A1500]"
                  }`}>
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          )}

          {currentStep > 0 && !["rr_input", "liq_strength"].includes(node.type) && (
            <button onClick={() => {
              let prev = currentStep - 1
              while (prev > 0) {
                const prevNode = DECISION_TREE[prev]
                if (prevNode.id === "prev_bias" && treeValues.bias !== "inside" && treeValues.bias !== "took_none") {
                  prev--
                } else {
                  break
                }
              }
              setCurrentStep(prev)
            }}
              className="w-full mt-3 py-2 text-xs text-[#444444] hover:text-[#666666]">
              ← Previous question
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── GRADING ──
  if (treePhase === "grading") return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-md p-12 text-center">
        <div className="text-4xl mb-4 animate-pulse">🧠</div>
        <p className="text-[#C9A84C] font-bold">Grading your backtest setup...</p>
        <p className="text-[#444444] text-sm mt-2">Analysing against your strategy rules</p>
      </div>
    </div>
  )

  // ── RESULT ──
  if (treePhase === "result" && result) {
    const gradeInfo    = GRADES[result.grade] || GRADES["B"]
    const riskPct      = result.grade !== "No Trade" ? (settings?.[gradeInfo.risk] || 1) : 0
    const accountSize  = settings?.account_size || 5000
    const riskAmount   = (accountSize * riskPct) / 100
    const sl           = parseFloat(slPipsInput) || 0
    const suggestedLot = sl > 0 ? (riskAmount / (sl * 10)).toFixed(2) : null

    return (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
        <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center p-5 border-b border-[#222222]">
            <div>
              <h3 className="text-[#C9A84C] font-bold text-lg">Backtest Setup Grade</h3>
              <p className="text-[#444444] text-xs mt-1">{pair} {direction} — {session} — RR: {treeValues.rr}R planned</p>
            </div>
            <button onClick={onCancel} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
          </div>
          <div className="p-5 space-y-4">
            {/* Grade badge */}
            <div className="rounded p-5 border-2 text-center" style={{ backgroundColor: gradeInfo.bg, borderColor: gradeInfo.color }}>
              <div className="text-4xl font-bold mb-1" style={{ color: gradeInfo.color }}>{result.grade}</div>
              <div className="text-xs mb-1" style={{ color: gradeInfo.color }}>{gradeInfo.label}</div>
              <div className="text-xs" style={{ color: gradeInfo.color }}>Planned RR: {treeValues.rr}R</div>
            </div>

            {/* AI Reasoning */}
            <div className="bg-[#0D0D0D] border border-[#222222] rounded p-4">
              <p className="text-[#666666] text-xs uppercase tracking-wider mb-2">AI Reasoning</p>
              <p className="text-[#CCCCCC] text-sm leading-relaxed">{result.reasoning}</p>
            </div>

            {/* Lot calculator */}
            {result.grade !== "No Trade" && (
              <div className="bg-[#0D0D0D] border border-[#222222] rounded p-4">
                <p className="text-[#666666] text-xs uppercase tracking-wider mb-3">Risk & Lot Size</p>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[#C9A84C] text-xl font-bold">{riskPct}%</span>
                  <span className="text-[#888888] text-sm">${riskAmount.toFixed(2)} at risk</span>
                </div>
                <input type="number" step="any" placeholder="Enter SL pips to get lot size" value={slPipsInput}
                  onChange={e => setSlPipsInput(e.target.value)}
                  className="w-full bg-[#111111] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C] mb-3" />
                {suggestedLot && (
                  <div className="grid grid-cols-3 gap-2">
                    {[["SL Pips", slPipsInput, "#CCCCCC"], ["Risk $", `$${riskAmount.toFixed(2)}`, "#C9A84C"], ["Lot Size", suggestedLot, "#C9A84C"]].map(([l, v, c]) => (
                      <div key={l} className={l === "Lot Size" ? "bg-[#1A1500] border border-[#C9A84C] rounded p-2 text-center" : "bg-[#111111] rounded p-2 text-center"}>
                        <div className="text-[#444444] text-xs mb-1">{l}</div>
                        <div className={`font-bold ${l === "Lot Size" ? "text-lg" : ""}`} style={{ color: c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {result.warnings?.length > 0 && (
              <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-3">
                <p className="text-[#CC4444] text-xs font-bold uppercase mb-2">⚠ Warnings</p>
                {result.warnings.map((w, i) => <p key={i} className="text-[#884444] text-sm">• {w}</p>)}
              </div>
            )}
            {result.strengths?.length > 0 && (
              <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-3">
                <p className="text-[#3DAA6A] text-xs font-bold uppercase mb-2">✓ Strengths</p>
                {result.strengths.map((s, i) => <p key={i} className="text-[#446644] text-sm">• {s}</p>)}
              </div>
            )}

            {/* Integrity flags */}
            <div className="bg-[#0D0D0D] border border-[#333333] rounded p-4 space-y-4">
              <p className="text-[#C9A84C] text-xs font-bold uppercase tracking-wider">Backtest Integrity Flags</p>
              <div>
                <p className="text-[#888888] text-sm mb-2">Would you take this trade live?</p>
                <div className="flex gap-2">
                  {[[true, "✓ YES", "#3DAA6A"], [false, "✕ NO", "#CC4444"]].map(([val, label, col]) => (
                    <button key={String(val)} onClick={() => setWouldTakeLive(val)}
                      className="flex-1 py-2 rounded text-sm font-bold border transition-all"
                      style={wouldTakeLive === val ? { backgroundColor: col, borderColor: col, color: "white" } : { background: "#0D0D0D", borderColor: "#333333", color: "#555555" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[#888888] text-sm mb-1">Did you know the outcome before grading?</p>
                <div className="flex gap-2">
                  {[[true, "⚠ YES (Hindsight)", "#CC4444"], [false, "✓ NO (Clean)", "#3DAA6A"]].map(([val, label, col]) => (
                    <button key={String(val)} onClick={() => setHindsightBias(val)}
                      className="flex-1 py-2 rounded text-sm font-bold border transition-all"
                      style={hindsightBias === val ? { backgroundColor: col, borderColor: col, color: "white" } : { background: "#0D0D0D", borderColor: "#333333", color: "#555555" }}>
                      {label}
                    </button>
                  ))}
                </div>
                {hindsightBias === true && <p className="text-[#CC4444] text-xs mt-2">⚠ Will be flagged as hindsight-biased in your stats.</p>}
              </div>
            </div>
          </div>
          <div className="p-5 border-t border-[#222222]">
            <button onClick={handleUseGrade}
              className="w-full py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
              USE THIS GRADE → Fill Trade Form
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── TRADE FORM ────────────────────────────────────────────────────────────────
function TradeForm({ onSave, onCancel, settings, checklistData }) {
  const [form, setForm] = useState({
    date:       new Date().toISOString().split("T")[0],
    pair:       checklistData?.pair      || "EURUSD",
    session:    checklistData?.session   || "LONDON",
    bias:       checklistData?.bias      || "BULLISH",
    poi:        [],
    planned_rr: checklistData?.plannedRr || "",
    direction:  checklistData?.direction || "BUY",
    sl_pips:    checklistData?.slPips    || "",
    lot:        checklistData?.lotSize   || "",
    pips:       "",
    execution_review: [],
    notes:      "",
    grade:      checklistData?.grade     || "A",
    would_take_live: checklistData?.wouldTakeLive !== undefined ? (checklistData.wouldTakeLive ? 1 : 0) : null,
    hindsight_bias:  checklistData?.hindsightBias !== undefined ? (checklistData.hindsightBias  ? 1 : 0) : null,
  })
  const fileRef = useRef()
  const [screenshots, setScreenshots] = useState([])
  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  const pips       = parseFloat(form.pips)    || 0
  const slPips     = parseFloat(form.sl_pips) || 0
  const lot        = parseFloat(form.lot)     || 0
  const achievedRr = slPips > 0 ? (pips / slPips).toFixed(2) : "—"
  const livePnl    = calcPnl(pips, lot)
  const riskAmount = getRiskAmount(form.grade, settings)
  const biasAlignment = form.bias && form.direction
    ? ((form.bias === "BULLISH" && form.direction === "BUY") || (form.bias === "BEARISH" && form.direction === "SELL"))
      ? "✅ ALIGNED" : "❌ MISALIGNED"
    : "—"
  const discipline = form.execution_review.includes("STABLE")
    ? "✅ DISCIPLINED"
    : form.execution_review.some(e => ["FOMO", "GREED", "FEAR"].includes(e))
    ? "❌ EMOTIONAL" : "⚠️ REVIEW"
  const result = pips > 0 ? "WIN" : pips < 0 ? "LOSS" : form.pips !== "" ? "BE" : "—"

  async function handleSave() {
    if (!form.pair || !form.direction) { alert("Pair and direction required"); return }
    const finalPips   = parseFloat(form.pips)    || 0
    const finalSlPips = parseFloat(form.sl_pips) || 0
    const finalLot    = parseFloat(form.lot)     || 0
    let screenshotPaths = []
    if (screenshots.length > 0) {
      const fd = new FormData()
      screenshots.forEach(f => fd.append("screenshots", f))
      const res = await axios.post(`${API}/api/upload/multi`, fd, { headers: { "Content-Type": "multipart/form-data" } })
      screenshotPaths = res.data.filenames
    }
    const trade = {
      ...form,
      poi:              JSON.stringify(form.poi),
      conditions_json:  JSON.stringify(form.poi),
      execution_review: JSON.stringify(form.execution_review),
      achieved_rr:      finalSlPips > 0 ? (finalPips / finalSlPips).toFixed(2) : 0,
      bias_alignment:   ((form.bias === "BULLISH" && form.direction === "BUY") || (form.bias === "BEARISH" && form.direction === "SELL")) ? "ALIGNED" : "MISALIGNED",
      discipline:       form.execution_review.includes("STABLE") ? "DISCIPLINED" : form.execution_review.some(e => ["FOMO", "GREED", "FEAR"].includes(e)) ? "EMOTIONAL" : "REVIEW",
      result:           finalPips > 0 ? "win" : finalPips < 0 ? "loss" : "breakeven",
      pnl:              calcPnl(finalPips, finalLot) - (parseFloat(form.commission) || 0),
      screenshot_path:  screenshotPaths.length > 0 ? JSON.stringify(screenshotPaths) : null,
    }
    onSave(trade)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-5 border-b border-[#222222]">
          <div>
            <h3 className="text-[#C9A84C] font-bold text-xl">Log Backtest Trade</h3>
            {checklistData && <p className="text-[#3DAA6A] text-xs mt-1">✓ Pre-filled from checklist — grade: {checklistData.grade} · RR: {checklistData.plannedRr}R</p>}
          </div>
          <button onClick={onCancel} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
        </div>
        <div className="p-5 space-y-5">
          {checklistData && (
            <div className="bg-[#0D0D0D] border border-[#333333] rounded p-3 flex gap-4 text-xs flex-wrap">
              <span className="text-[#444444]">Grade: <span className="text-[#C9A84C] font-bold">{checklistData.grade}</span></span>
              <span className="text-[#444444]">Planned RR: <span className="text-[#C9A84C] font-bold">{checklistData.plannedRr}R</span></span>
              <span className="text-[#444444]">Would take live: <span className={checklistData.wouldTakeLive ? "text-[#3DAA6A] font-bold" : "text-[#CC4444] font-bold"}>{checklistData.wouldTakeLive ? "YES" : "NO"}</span></span>
              <span className="text-[#444444]">Hindsight bias: <span className={checklistData.hindsightBias ? "text-[#CC4444] font-bold" : "text-[#3DAA6A] font-bold"}>{checklistData.hindsightBias ? "⚠ YES" : "✓ CLEAN"}</span></span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[#666666] text-sm block mb-2">Trade Date (on chart)</label>
              <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
            </div>
            <div>
              <label className="text-[#666666] text-sm block mb-2">Pair</label>
              <div className="flex gap-2">
                {["EURUSD", "XAUUSD"].map(p => (
                  <button key={p} onClick={() => set("pair", p)}
                    className={`flex-1 py-2 rounded text-sm font-bold ${form.pair === p ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#555555]"}`}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Session</label>
            <div className="flex gap-2 flex-wrap">
              {SESSION_OPTIONS.map(s => (
                <button key={s} onClick={() => set("session", s)}
                  className={`px-4 py-2 rounded text-sm font-bold ${form.session === s ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#555555]"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Bias</label>
            <div className="flex gap-2">
              {["BULLISH", "BEARISH"].map(b => (
                <button key={b} onClick={() => set("bias", b)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.bias === b ? b === "BULLISH" ? "bg-[#3DAA6A] text-white" : "bg-[#CC4444] text-white" : "bg-[#1A1A1A] text-[#555555]"}`}>{b}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">POI</label>
            <MultiSelect options={POI_OPTIONS} value={form.poi} onChange={val => set("poi", val)} />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Planned RR</label>
            <input type="number" step="any" value={form.planned_rr} onChange={e => set("planned_rr", e.target.value)}
              placeholder="e.g. 2.5"
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Execution</label>
            <div className="flex gap-2">
              {["BUY", "SELL"].map(d => (
                <button key={d} onClick={() => set("direction", d)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.direction === d ? d === "BUY" ? "bg-[#3DAA6A] text-white" : "bg-[#CC4444] text-white" : "bg-[#1A1A1A] text-[#555555]"}`}>{d}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[{ key: "sl_pips", label: "SL Pips" }, { key: "lot", label: "Lot" }, { key: "pips", label: "Pips (+win / -loss)" }].map(f => (
              <div key={f.key}>
                <label className="text-[#666666] text-sm block mb-2">{f.label}</label>
                <input type="number" step="any" value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
              </div>
            ))}
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Setup Grade</label>
            <div className="flex gap-2">
              {["A+", "A", "B", "No Trade"].map(g => (
                <button key={g} onClick={() => set("grade", g)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.grade === g ? g === "A+" ? "bg-[#C9A84C] text-[#0D0D0D]" : g === "A" ? "bg-[#3DAA6A] text-white" : g === "B" ? "bg-[#886600] text-white" : "bg-[#CC4444] text-white" : "bg-[#1A1A1A] text-[#555555]"}`}>{g}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Screenshots (up to {MAX_SS})</label>
            <input type="file" accept="image/*" multiple ref={fileRef}
              onChange={e => {
                const newFiles = Array.from(e.target.files)
                setScreenshots(prev => [...prev, ...newFiles].slice(0, MAX_SS))
                e.target.value = ""
              }}
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#666666] text-sm" />
            {screenshots.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {screenshots.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 bg-[#0A1A0A] px-2 py-1 rounded">
                    <span className="text-[#3DAA6A] text-xs">✓ {f.name.slice(0, 20)}</span>
                    <button onClick={() => setScreenshots(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[#CC4444] text-xs ml-1 hover:text-red-300">✕</button>
                  </div>
                ))}
                <span className="text-[#444444] text-xs self-center">{screenshots.length}/{MAX_SS}</span>
              </div>
            )}
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3}
              placeholder="What did you observe? Why does this qualify?"
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C] resize-none" />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Execution Review</label>
            <MultiSelect options={EXECUTION_REVIEW_OPTIONS} value={form.execution_review} onChange={val => set("execution_review", val)} />
          </div>
          <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded p-4">
            <div className="text-[#444444] text-xs uppercase tracking-wider mb-3 font-bold">Auto Calculated</div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Risk Amount",     value: `$${riskAmount.toFixed(2)}`,                            color: "#C9A84C"  },
                { label: "P&L",             value: livePnl !== 0 ? `$${livePnl.toFixed(2)}` : "—",        color: livePnl >= 0 ? "#3DAA6A" : "#CC4444" },
                { label: "Achieved RR",     value: achievedRr,                                             color: "#C9A84C"  },
                { label: "Bias Alignment",  value: biasAlignment,                                          color: biasAlignment.includes("ALIGNED") && !biasAlignment.includes("MIS") ? "#3DAA6A" : "#CC4444" },
                { label: "Discipline",      value: discipline,                                             color: discipline.includes("DISC") ? "#3DAA6A" : discipline.includes("EMOT") ? "#CC4444" : "#886600" },
                { label: "Result",          value: result,                                                 color: result === "WIN" ? "#3DAA6A" : result === "LOSS" ? "#CC4444" : "#888888" },
              ].map(item => (
                <div key={item.label} className="text-center">
                  <div className="text-[#444444] text-xs mb-1">{item.label}</div>
                  <div className="text-sm font-bold" style={{ color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 flex gap-3 border-t border-[#222222]">
          <button onClick={onCancel} className="flex-1 py-3 rounded text-sm text-[#666666] border border-[#333333]">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-3 rounded text-sm font-bold bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">Save Backtest</button>
        </div>
      </div>
    </div>
  )
}

// ── TRADE DETAIL ──────────────────────────────────────────────────────────────
function TradeDetail({ trade, onClose, onDelete, onNotesSaved, onScreenshotsUpdated, settings }) {
  if (!trade) return null
  let poi = [], er = []
  try { poi = JSON.parse(trade.conditions_json || trade.poi || "[]") } catch {}
  try { er  = JSON.parse(trade.execution_review || "[]") } catch {}
  const riskAmount = getRiskAmount(trade.grade, settings)

  const [ssPaths, setSsPaths]             = useState(parsePaths(trade.screenshot_path))
  const [editingNotes, setEditingNotes]   = useState(false)
  const [notesVal, setNotesVal]           = useState(trade.notes || "")
  const [saving, setSaving]               = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingSS, setAddingSS]           = useState(false)
  const [newSS, setNewSS]                 = useState([])
  const [ssUploading, setSsUploading]     = useState(false)
  const ssRef = useRef()

  async function saveNotes() {
    setSaving(true)
    try {
      await axios.patch(`${API}/api/backtest/${trade.id}/notes`, { notes: notesVal })
      onNotesSaved(trade.id, notesVal); setEditingNotes(false)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  async function uploadNewScreenshots() {
    if (newSS.length === 0) return
    setSsUploading(true)
    try {
      const fd = new FormData()
      newSS.forEach(f => fd.append("screenshots", f))
      const res = await axios.patch(`${API}/api/backtest/${trade.id}/screenshots`, fd, { headers: { "Content-Type": "multipart/form-data" } })
      const updated = parsePaths(res.data.screenshot_path)
      setSsPaths(updated); onScreenshotsUpdated(trade.id, res.data.screenshot_path)
      setNewSS([]); setAddingSS(false)
    } catch (e) { console.error(e) }
    finally { setSsUploading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-6">
      <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-5 border-b border-[#222222]">
          <div>
            <h3 className="text-[#C9A84C] font-bold text-xl">{trade.pair} — {trade.direction}</h3>
            <p className="text-[#444444] text-sm mt-1">{trade.date} · {trade.session} · BACKTEST</p>
            <div className="flex gap-3 mt-1">
              {trade.would_take_live !== null && trade.would_take_live !== undefined && (
                <span className={`text-xs font-bold ${trade.would_take_live ? "text-[#3DAA6A]" : "text-[#CC4444]"}`}>
                  {trade.would_take_live ? "✓ Would take live" : "✕ Would NOT take live"}
                </span>
              )}
              {trade.hindsight_bias !== null && trade.hindsight_bias !== undefined && (
                <span className={`text-xs font-bold ${trade.hindsight_bias ? "text-[#CC4444]" : "text-[#3DAA6A]"}`}>
                  {trade.hindsight_bias ? "⚠ Hindsight bias" : "✓ Clean grade"}
                </span>
              )}
              {trade.planned_rr && (
                <span className="text-[#C9A84C] text-xs font-bold">RR: {trade.planned_rr}R planned</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs font-bold text-[#CC4444] border border-[#CC4444] rounded hover:bg-[#CC4444] hover:text-white transition-all">
                🗑 Delete
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => onDelete(trade.id)} className="px-3 py-1.5 text-xs font-bold bg-[#CC4444] text-white rounded">Confirm</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#888888] rounded">Cancel</button>
              </div>
            )}
            <button onClick={onClose} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Pair",       trade.pair],
              ["Session",    trade.session],
              ["Bias",       trade.bias],
              ["POI",        poi.join(", ") || "—"],
              ["Planned RR", trade.planned_rr ? `${trade.planned_rr}R` : "—"],
              ["Execution",  trade.direction],
              ["SL Pips",    trade.sl_pips],
              ["Lot",        trade.lot],
              ["Pips",       trade.pips],
              ["Grade",      trade.grade],
            ].map(([l, v]) => (
              <div key={l} className="bg-[#0D0D0D] rounded p-3">
                <div className="text-[#444444] text-xs mb-1">{l}</div>
                <div className="text-[#CCCCCC] text-sm font-bold">{v || "—"}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[#444444] text-sm font-bold">
                Screenshots {ssPaths.length > 0 && <span className="text-[#555555] font-normal">({ssPaths.length}/{MAX_SS})</span>}
              </div>
              {ssPaths.length < MAX_SS && !addingSS && (
                <button onClick={() => setAddingSS(true)} className="text-[#C9A84C] text-xs hover:underline">+ Add SS</button>
              )}
            </div>
            <ScreenshotGallery paths={ssPaths} />
            {addingSS && (
              <div className="mt-3 bg-[#0D0D0D] border border-[#333333] rounded p-3">
                <p className="text-[#666666] text-xs mb-2">Add up to {MAX_SS - ssPaths.length} more</p>
                <input type="file" accept="image/*" multiple ref={ssRef}
                  onChange={e => {
                    setNewSS(prev => [...prev, ...Array.from(e.target.files)].slice(0, MAX_SS - ssPaths.length))
                    e.target.value = ""
                  }}
                  className="w-full text-[#666666] text-sm mb-2" />
                {newSS.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {newSS.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 bg-[#0A1A0A] px-2 py-1 rounded">
                        <span className="text-[#3DAA6A] text-xs">{f.name.slice(0, 20)}</span>
                        <button onClick={() => setNewSS(prev => prev.filter((_, idx) => idx !== i))} className="text-[#CC4444] text-xs ml-1">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={uploadNewScreenshots} disabled={ssUploading || newSS.length === 0}
                    className="px-4 py-1.5 text-xs font-bold bg-[#C9A84C] text-[#0D0D0D] rounded disabled:opacity-50">
                    {ssUploading ? "Uploading..." : `Upload${newSS.length > 0 ? ` (${newSS.length})` : ""}`}
                  </button>
                  <button onClick={() => { setAddingSS(false); setNewSS([]) }}
                    className="px-4 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#666666] rounded">Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[#444444] text-sm font-bold">Notes</div>
              {!editingNotes && <button onClick={() => setEditingNotes(true)} className="text-[#C9A84C] text-xs hover:underline">✏ Edit</button>}
            </div>
            {editingNotes ? (
              <div>
                <textarea value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={4}
                  className="w-full bg-[#0D0D0D] border border-[#C9A84C] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none resize-none mb-2" />
                <div className="flex gap-2">
                  <button onClick={saveNotes} disabled={saving}
                    className="px-4 py-1.5 text-xs font-bold bg-[#C9A84C] text-[#0D0D0D] rounded disabled:opacity-50">
                    {saving ? "Saving..." : "Save Notes"}
                  </button>
                  <button onClick={() => { setEditingNotes(false); setNotesVal(trade.notes || "") }}
                    className="px-4 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#666666] rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-[#888888] text-sm bg-[#0D0D0D] rounded p-3 leading-relaxed min-h-[40px]">
                {notesVal || <span className="text-[#333333]">No notes</span>}
              </p>
            )}
          </div>

          {er.length > 0 && (
            <div>
              <div className="text-[#444444] text-sm mb-2 font-bold">Execution Review</div>
              <div className="flex gap-2 flex-wrap">
                {er.map(e => (
                  <span key={e} className={`px-3 py-1 text-sm rounded font-bold ${e === "STABLE" ? "bg-[#0A1A0A] text-[#3DAA6A]" : ["FOMO", "GREED", "FEAR"].includes(e) ? "bg-[#1A0A0A] text-[#CC4444]" : "bg-[#1A1A1A] text-[#888888]"}`}>{e}</span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[
              ["Risk Amount",    `$${riskAmount.toFixed(2)}`,                                           "#C9A84C"],
              ["P&L",           trade.pnl ? `$${parseFloat(trade.pnl).toFixed(2)}` : "—",              (parseFloat(trade.pnl) || 0) >= 0 ? "#3DAA6A" : "#CC4444"],
              ["Achieved RR",   trade.achieved_rr,                                                      "#C9A84C"],
              ["Bias Alignment", trade.bias_alignment,                                                  trade.bias_alignment === "ALIGNED" ? "#3DAA6A" : "#CC4444"],
              ["Discipline",    trade.discipline,                                                       trade.discipline === "DISCIPLINED" ? "#3DAA6A" : "#CC4444"],
              ["Result",        parseFloat(trade.pips) > 0 ? "WIN" : parseFloat(trade.pips) < 0 ? "LOSS" : "BE", parseFloat(trade.pips) > 0 ? "#3DAA6A" : "#CC4444"],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-[#0D0D0D] rounded p-3">
                <div className="text-[#444444] text-xs mb-1">{l}</div>
                <div className="text-sm font-bold" style={{ color: c }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MAIN BACKTEST ─────────────────────────────────────────────────────────────
export default function Backtest() {
  const [trades, setTrades]               = useState([])
  const [settings, setSettings]           = useState(null)
  const [loading, setLoading]             = useState(true)
  const [showChecklist, setShowChecklist] = useState(false)
  const [checklistData, setChecklistData] = useState(null)
  const [showForm, setShowForm]           = useState(false)
  const [selectedTrade, setSelectedTrade] = useState(null)
  const [filter, setFilter]               = useState("all")

  async function loadTrades() {
    try {
      const [r, s] = await Promise.all([axios.get(`${API}/api/backtest`), axios.get(`${API}/api/settings`)])
      const sorted = [...r.data].sort((a, b) => new Date(b.date) - new Date(a.date))
      setTrades(sorted); setSettings(s.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadTrades() }, [])

  function handleChecklistComplete(data) { setChecklistData(data); setShowChecklist(false); setShowForm(true) }
  function handleLogBacktest() { setChecklistData(null); setShowChecklist(true) }

  async function saveTrade(form) {
    try {
      await axios.post(`${API}/api/backtest`, form)
      setShowForm(false); setChecklistData(null); loadTrades()
    } catch (e) { console.error(e) }
  }

  async function deleteTrade(id) {
    try {
      await axios.delete(`${API}/api/backtest/${id}`)
      setSelectedTrade(null); loadTrades()
    } catch (e) { console.error(e) }
  }

  function handleNotesSaved(id, notes) {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, notes } : t))
    setSelectedTrade(prev => prev?.id === id ? { ...prev, notes } : prev)
  }

  function handleScreenshotsUpdated(id, screenshot_path) {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, screenshot_path } : t))
    setSelectedTrade(prev => prev?.id === id ? { ...prev, screenshot_path } : prev)
  }

  const filtered = trades.filter(t => {
    if (filter === "all")    return true
    if (filter === "win")    return t.result === "win"
    if (filter === "loss")   return t.result === "loss"
    if (filter === "aplus")  return t.grade === "A+"
    if (filter === "london") return t.session === "LONDON"
    if (filter === "ny")     return t.session?.includes("NY")
    if (filter === "clean")  return !t.hindsight_bias
    if (filter === "live")   return t.would_take_live === 1 || t.would_take_live === true
    return true
  })

  const totalPnl  = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0)
  const wins      = trades.filter(t => t.result === "win").length
  const losses    = trades.filter(t => t.result === "loss").length
  const winRate   = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : 0
  const closed    = trades.filter(t => t.achieved_rr !== null && t.achieved_rr !== 0 && t.achieved_rr !== "0")
  const avgRR     = closed.length > 0 ? (closed.reduce((s, t) => s + (parseFloat(t.achieved_rr) || 0), 0) / closed.length).toFixed(2) : 0
  const cleanCount = trades.filter(t => !t.hindsight_bias).length

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[#444444]">Loading backtests...</div>
    </div>
  )

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px" }}>
      {selectedTrade && (
        <TradeDetail trade={selectedTrade} settings={settings}
          onClose={() => setSelectedTrade(null)}
          onDelete={deleteTrade}
          onNotesSaved={handleNotesSaved}
          onScreenshotsUpdated={handleScreenshotsUpdated} />
      )}
      {showChecklist && (
        <BacktestChecklist settings={settings} onComplete={handleChecklistComplete} onCancel={() => setShowChecklist(false)} />
      )}
      {showForm && (
        <TradeForm onSave={saveTrade} onCancel={() => { setShowForm(false); setChecklistData(null) }} settings={settings} checklistData={checklistData} />
      )}

      <div className="flex justify-between items-center mb-4" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="text-[#C9A84C] text-2xl font-bold">Backtest Journal</h2>
          <p className="text-[#444444] text-sm mt-1">Log historical trades to find your real statistical edge. Target: 50 trades.</p>
        </div>
        <button onClick={handleLogBacktest} className="px-5 py-2 bg-[#C9A84C] text-[#0D0D0D] rounded text-sm font-bold hover:bg-[#E0BC5C]">
          + Log Backtest
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-4" style={{ flexShrink: 0 }}>
        {[
          { label: "Total Backtests", value: trades.length,                   color: "#C9A84C"  },
          { label: "Win Rate",        value: `${winRate}%`,                   color: parseFloat(winRate) >= 50 ? "#3DAA6A" : "#CC4444" },
          { label: "Wins / Losses",   value: `${wins} / ${losses}`,           color: "#C9A84C"  },
          { label: "Avg RR",          value: avgRR,                           color: "#C9A84C"  },
          { label: "Simulated P&L",   value: `$${totalPnl.toFixed(2)}`,      color: totalPnl >= 0 ? "#3DAA6A" : "#CC4444" },
        ].map(s => (
          <div key={s.label} className="bg-[#111111] border border-[#222222] rounded p-4">
            <div className="text-[#444444] text-sm mb-1">{s.label}</div>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {trades.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#222222] rounded px-4 py-2 mb-3 flex gap-6 text-xs" style={{ flexShrink: 0 }}>
          <span className="text-[#444444]">Clean grades: <span className="text-[#3DAA6A] font-bold">{cleanCount}</span> / {trades.length}</span>
          <span className="text-[#444444]">Hindsight-biased: <span className={trades.length - cleanCount > 0 ? "text-[#CC4444] font-bold" : "text-[#3DAA6A] font-bold"}>{trades.length - cleanCount}</span></span>
          <span className="text-[#444444]">Would take live: <span className="text-[#C9A84C] font-bold">{trades.filter(t => t.would_take_live === 1 || t.would_take_live === true).length}</span></span>
        </div>
      )}

      <div className="mb-3" style={{ flexShrink: 0 }}>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-[#666666]">Progress to 50 backtests</span>
          <span className="text-[#C9A84C] font-bold">{trades.length} / 50</span>
        </div>
        <div className="h-2 bg-[#1A1A1A] rounded overflow-hidden">
          <div className="h-full bg-[#C9A84C] rounded transition-all" style={{ width: `${Math.min((trades.length / 50) * 100, 100)}%` }} />
        </div>
      </div>

      <div className="flex justify-between items-center mb-3 flex-wrap gap-2" style={{ flexShrink: 0 }}>
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "all",    label: "All"              },
            { key: "win",    label: "Wins"             },
            { key: "loss",   label: "Losses"           },
            { key: "aplus",  label: "A+ Only"          },
            { key: "london", label: "London"           },
            { key: "ny",     label: "New York"         },
            { key: "clean",  label: "✓ Clean Only"     },
            { key: "live",   label: "Would Take Live"  },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${filter === f.key ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
        <div className="bg-[#111111] border border-[#222222] rounded" style={{ height: "100%", overflow: "auto" }}>
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-[#333333]">
              <div className="text-4xl mb-3">🔬</div>
              <p className="text-sm">No backtest trades logged yet</p>
              <p className="text-xs mt-1">Complete the full decision tree checklist to log a backtest</p>
            </div>
          ) : (
            <table className="text-sm" style={{ whiteSpace: "nowrap", borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#0D0D0D" }}>
                <tr className="border-b border-[#222222] text-[#555555] uppercase text-xs">
                  {["Date", "Pair", "Session", "Bias", "POI", "Planned RR", "Execution", "SL Pips", "Lot", "Pips",
                    "Risk Amount", "P&L", "Achieved RR", "Bias Alignment", "Discipline", "Result", "Integrity", "SS", "Notes", "Execution Review"
                  ].map(h => <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const pips   = parseFloat(t.pips) || 0
                  const isWin  = pips > 0
                  const isLoss = pips < 0
                  let poi = [], er = []
                  try { poi = JSON.parse(t.conditions_json || t.poi || "[]") } catch {}
                  try { er  = JSON.parse(t.execution_review || "[]") } catch {}
                  const riskAmount = getRiskAmount(t.grade, settings)
                  const ssPaths    = parsePaths(t.screenshot_path)
                  return (
                    <tr key={t.id} onClick={() => setSelectedTrade(t)}
                      className="border-b border-[#1A1A1A] cursor-pointer hover:bg-[#161616] transition-all">
                      <td className="px-4 py-3 text-[#888888]">{t.date}</td>
                      <td className="px-4 py-3 text-[#CCCCCC] font-bold">{t.pair}</td>
                      <td className="px-4 py-3 text-[#888888]">{t.session || "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: t.bias === "BULLISH" ? "#3DAA6A" : "#CC4444" }}>{t.bias || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {poi.length > 0 ? poi.map(p => (
                            <span key={p} className="px-2 py-0.5 bg-[#1A1500] text-[#C9A84C] rounded text-xs font-bold">{p}</span>
                          )) : <span className="text-[#333333]">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#C9A84C] font-bold">{t.planned_rr ? `${t.planned_rr}R` : "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: t.direction === "BUY" ? "#3DAA6A" : "#CC4444" }}>{t.direction}</td>
                      <td className="px-4 py-3 text-[#888888]">{t.sl_pips || "—"}</td>
                      <td className="px-4 py-3 text-[#888888]">{t.lot || "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: isWin ? "#3DAA6A" : isLoss ? "#CC4444" : "#888888" }}>
                        {pips !== 0 ? (pips > 0 ? `+${t.pips}` : t.pips) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[#C9A84C] font-bold">${riskAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: (parseFloat(t.pnl) || 0) >= 0 ? "#3DAA6A" : "#CC4444" }}>
                        {t.pnl ? `$${parseFloat(t.pnl).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-[#C9A84C] font-bold">{t.achieved_rr || "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: t.bias_alignment === "ALIGNED" ? "#3DAA6A" : "#CC4444" }}>{t.bias_alignment || "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: t.discipline === "DISCIPLINED" ? "#3DAA6A" : t.discipline === "EMOTIONAL" ? "#CC4444" : "#886600" }}>{t.discipline || "—"}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: isWin ? "#3DAA6A" : isLoss ? "#CC4444" : "#888888" }}>{isWin ? "WIN" : isLoss ? "LOSS" : "BE"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {(t.hindsight_bias === 1 || t.hindsight_bias === true) && <span className="text-[#CC4444] text-xs font-bold">⚠ Hindsight</span>}
                          {(t.would_take_live === 0 || t.would_take_live === false) && <span className="text-[#886600] text-xs font-bold">✕ Not live</span>}
                          {(t.hindsight_bias === 0 || t.hindsight_bias === false) && (t.would_take_live === 1 || t.would_take_live === true) && <span className="text-[#3DAA6A] text-xs font-bold">✓ Clean</span>}
                          {t.hindsight_bias === null && <span className="text-[#333333] text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ssPaths.length > 0
                          ? <span className="text-[#3DAA6A] text-xs font-bold">📸 {ssPaths.length}</span>
                          : <span className="text-[#333333]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[#555555]" style={{ maxWidth: "200px" }}>
                        <span title={t.notes}>{t.notes ? t.notes.slice(0, 30) + (t.notes.length > 30 ? "..." : "") : "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {er.length > 0 ? er.map(e => (
                            <span key={e} className={`px-2 py-0.5 rounded text-xs font-bold ${e === "STABLE" ? "bg-[#0A1A0A] text-[#3DAA6A]" : ["FOMO", "GREED", "FEAR"].includes(e) ? "bg-[#1A0A0A] text-[#CC4444]" : "bg-[#1A1A1A] text-[#666666]"}`}>{e}</span>
                          )) : <span className="text-[#333333]">—</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
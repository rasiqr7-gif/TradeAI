import { useState, useEffect } from "react"
import axios from "axios"
import { computeGrade, buildAiReasoningPrompt, getScenarioOptions } from "../utils/GradeUtils"

const API = "http://localhost:3001"

const GRADES = {
  "A+":       { color: "#C9A84C", bg: "#1A1500", label: "A+ SETUP",  risk: "default_risk_aplus" },
  "A":        { color: "#3DAA6A", bg: "#0A1A0A", label: "A SETUP",   risk: "default_risk_a"     },
  "B":        { color: "#886600", bg: "#1A1000", label: "B SETUP",   risk: "default_risk_b"     },
  "No Trade": { color: "#CC4444", bg: "#1A0A0A", label: "NO TRADE",  risk: null                 },
}

// ── DECISION TREE ─────────────────────────────────────────────────────────────
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
      { label: "No uncleared liquidity above SL — clean ✓",                                          value: "clean",        probability: "high"   },
      { label: "Liquidity exists above SL but strong OB with trend justifies the entry — lower prob", value: "ob_justifies", probability: "medium" },
      { label: "Liquidity exists above SL with no justification — do not enter",                      value: "liq_block",    probability: "none",  safe: false },
    ],
  },
  {
    id: "opposing_fvg",
    question: "Is there an opposing FVG between your entry and your target?",
    hint: "Check from 1H down to 5M. If the 1H FVG is being respected, the answer is respected — regardless of lower timeframe closes.",
    type: "single",
    hardStop: false,
    options: [
      { label: "No opposing FVG — path is clear ✓",                        value: "none",         probability: "high" },
      { label: "Opposing FVG present but disrespected by candle close ✓",   value: "disrespected", probability: "high" },
      { label: "Opposing FVG present and being respected — do not enter",   value: "respected",    probability: "none", safe: false },
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
        <p className="text-[#444444] text-xs mb-6">A missed trade costs nothing. A bad trade costs real money.</p>
        <button onClick={onReset} className="w-full py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#666666] hover:text-[#999999]">
          ← Start Over
        </button>
      </div>
    </div>
  )
}

// ── ANSWER SUMMARY ────────────────────────────────────────────────────────────
function AnswerSummary({ answers, rrValue, liqStrength, onConfirm, onReset }) {
  const labels = {
    news: "News Check", bias: "Daily Bias", prev_bias: "Yesterday's Bias",
    scenario: "Day Scenario", poi_zone: "POI Fibonacci Zone",
    liquidity: "Path Liquidity", opposing_fvg: "Opposing FVG",
    crt: "1H CRT", cisd: "3M CISD", rr: "Planned RR", liq_strength: "Target Liquidity",
  }
  return (
    <div className="p-6 max-w-xl">
      <h3 className="text-[#C9A84C] text-lg font-bold mb-1">Review Your Answers</h3>
      <p className="text-[#444444] text-xs mb-5">Confirm everything is what you actually saw on the chart.</p>
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

// ── MAIN CHECKLIST ────────────────────────────────────────────────────────────
export default function Checklist({ flowState, updateFlow, resetFlow, onStartJournaling }) {
  const [strategy, setStrategy]     = useState(null)
  const [settings, setSettings]     = useState(null)
  const [tiltStatus, setTiltStatus] = useState(null)
  const [aiAdvice, setAiAdvice]     = useState("")
  const [adviceLoading, setAdviceLoading] = useState(false)

  const [currentStep, setCurrentStep] = useState(0)
  const [treeAnswers, setTreeAnswers] = useState({})
  const [treeValues, setTreeValues]   = useState({})
  const [hardStopped, setHardStopped] = useState(null)
  const [hardStopAnswer, setHardStopAnswer] = useState("")
  const [rrInput, setRrInput]         = useState("")
  const [rrError, setRrError]         = useState("")
  const [showSummary, setShowSummary] = useState(false)

  const {
    phase, pair, direction, session, mood,
    result, slPipsInput, journalStarted,
  } = flowState

  const setPhase        = v => updateFlow({ phase: v })
  const setPair         = v => updateFlow({ pair: v })
  const setDirection    = v => updateFlow({ direction: v })
  const setSession      = v => updateFlow({ session: v })
  const setMood         = v => updateFlow({ mood: v })
  const setResult       = v => updateFlow({ result: v })
  const setSlPipsInput  = v => updateFlow({ slPipsInput: v })
  const setJournalStarted = v => updateFlow({ journalStarted: v })

  useEffect(() => { loadServerData() }, [])

  async function loadServerData() {
    try {
      const [s, st, t] = await Promise.all([
        axios.get(`${API}/api/settings`),
        axios.get(`${API}/api/strategy`),
        axios.get(`${API}/api/trades`),
      ])
      setSettings(s.data)
      setStrategy(st.data)

      const trades      = t.data
      const today       = new Date().toISOString().split("T")[0]
      const todayTrades = trades.filter(tr => tr.date === today)
      const todayCount  = todayTrades.length
      const todayWins   = todayTrades.filter(tr => parseFloat(tr.pips) > 0).length
      const todayLosses = todayTrades.filter(tr => parseFloat(tr.pips) < 0).length

      let streak = 0
      for (const trade of trades) {
        if (parseFloat(trade.pips) < 0) streak++
        else break
      }

      const lastLoss     = trades.find(tr => parseFloat(tr.pips) < 0)
      const lastLossDate = lastLoss ? lastLoss.date : null
      const todayObj     = new Date(today)
      const lastLossObj  = lastLossDate ? new Date(lastLossDate) : null
      const daysDiff     = lastLossObj ? Math.floor((todayObj - lastLossObj) / (1000 * 60 * 60 * 24)) : null

      const status = {
        todayCount, todayWins, todayLosses, streak,
        lastLossDate, daysDiff, today,
        tradesAllowedToday: todayCount >= 2 ? 0 : 2 - todayCount,
      }

      if (todayCount >= 2) {
        status.lockType = todayWins === 2 ? "double_win" : todayLosses >= 2 ? "double_loss" : "daily_limit"
        updateFlow({ phase: "locked" })
      } else if (streak >= 2 && todayLosses >= 2) {
        status.lockType = "session_loss"
        updateFlow({ phase: "locked" })
      } else if (streak >= 2) {
        status.lockType = "streak_warning"
        status.tradesAllowedToday = todayCount >= 1 ? 0 : 1
        if (todayCount >= 1) {
          status.lockType = "streak_daily_limit"
          updateFlow({ phase: "locked" })
        } else if (phase === "setup") {
          updateFlow({ phase: "streak_warning" })
          loadAiAdvice(trades, streak)
        }
      } else if (streak === 0 && todayCount >= 1) {
        let prevLosses = 0
        for (let i = 1; i < trades.length; i++) {
          if (parseFloat(trades[i].pips) < 0) prevLosses++
          else break
        }
        if (prevLosses >= 2) {
          status.lockType = "streak_daily_limit_win"
          updateFlow({ phase: "locked" })
        }
      }
      setTiltStatus(status)
    } catch (e) { console.error(e) }
  }

  async function loadAiAdvice(trades, streak) {
    setAdviceLoading(true)
    try {
      const lossTrades = trades.filter(tr => parseFloat(tr.pips) < 0).slice(0, streak)
        .map(tr => ({ date: tr.date, pair: tr.pair, session: tr.session, grade: tr.grade, pips: tr.pips, notes: tr.notes }))
      const r = await axios.post(`${API}/api/ai`, {
        system: "You are a strict trading coach. Be direct, harsh if needed. Under 150 words.",
        prompt: `I have ${streak} consecutive losses.\n\nLosing trades:\n${JSON.stringify(lossTrades, null, 2)}\n\nTell me:\n1. Exact mistake type\n2. One specific fix before next trade\n3. One motivational sentence\n\nUnder 150 words. Brutal and direct.`,
      })
      setAiAdvice(r.data.response)
    } catch {
      setAiAdvice("Focus on your A+ setups only. One clean trade. That is all you need.")
    } finally { setAdviceLoading(false) }
  }

  function resetDecisionTree() {
    setCurrentStep(0); setTreeAnswers({}); setTreeValues({})
    setHardStopped(null); setHardStopAnswer(""); setRrInput("")
    setRrError(""); setShowSummary(false)
  }

  function handleFullReset() { resetDecisionTree(); resetFlow() }

  function getScenarioOpts() {
    return getScenarioOptions(direction, treeValues.bias || "", treeValues.prev_bias || "")
  }

  function getNodeOptions(node) {
    if (node.id === "scenario") return getScenarioOpts()
    return node.options || []
  }

  // find next valid step — skips prev_bias node when bias is not no-bias
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
    setShowSummary(false); setPhase("grading")
    try {
      const { grade, ceiling, warnings, filters } = computeGrade(treeValues, direction, mood)

      const { system, prompt } = buildAiReasoningPrompt({
        grade, treeAnswers, direction, pair, session,
        rr: treeValues.rr, warnings, filters, isBacktest: false,
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
          reasoning:       `This setup is graded ${grade} based on your filter results.`,
          risk_suggestion: "Use your standard risk for this grade.",
          strengths:       filters.f3 === "pass" ? ["Clear path to target — no opposing FVG"] : [],
        }
      }

      setResult(gradeResult); setPhase("result")
    } catch (e) { console.error(e); setPhase("result") }
  }

  function handleStartJournaling() {
    if (!result) return
    const gradeInfo    = GRADES[result.grade] || GRADES["B"]
    const riskPct      = result.grade !== "No Trade" ? (settings?.[gradeInfo.risk] || 1) : 0
    const accountSize  = settings?.account_size || 10000
    const riskAmount   = (accountSize * riskPct) / 100
    const suggestedLot = slPipsInput && parseFloat(slPipsInput) > 0
      ? (riskAmount / (parseFloat(slPipsInput) * 10)).toFixed(2) : ""

    const BULLISH_BIAS_VALUES = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
    const detectedBias = BULLISH_BIAS_VALUES.includes(treeValues.bias) || BULLISH_BIAS_VALUES.includes(treeValues.prev_bias)
      ? "BULLISH" : "BEARISH"

    const prefillData = {
      pair, direction, session,
      grade:          result.grade === "No Trade" ? "A" : result.grade,
      lot:            suggestedLot,
      sl_pips:        slPipsInput || "",
      mood,
      planned_rr:     treeValues.rr || "",
      bias:           detectedBias,
      checklistNotes: result.reasoning || "",
    }
    setJournalStarted(true)
    onStartJournaling(prefillData)
  }

  // ── LOCKED ────────────────────────────────────────────────────────────────
  if (phase === "locked") {
    const type = tiltStatus?.lockType
    const LOCK = {
      double_win:           { icon: "🏆", color: "#3DAA6A", border: "#3DAA6A", bg: "#0A1A0A", title: "TWO WINS TODAY",              message: "You nailed it. Bank it and walk away.",                     sub: "Protect your profits. The market will be here tomorrow.",           points: ["Log both trades in your journal", "Review what you did right today", "Come back tomorrow", "Don't give back today's profits"] },
      double_loss:          { icon: "🔴", color: "#CC4444", border: "#CC4444", bg: "#1A0A0A", title: "TWO LOSSES — SESSION LOCKED",  message: "You hit your daily loss limit. Stop now.",                  sub: "Two losses means the market is not giving you opportunities today.", points: ["Close all charts immediately", "Log both trades", "Review what went wrong honestly", "Come back tomorrow"] },
      daily_limit:          { icon: "✅", color: "#C9A84C", border: "#C9A84C", bg: "#1A1500", title: "DAILY LIMIT REACHED",          message: "Two trades done. Session complete.",                        sub: "Consistency beats greed.",                                          points: ["Log your trades", "Review your execution", "Rest and come back tomorrow"] },
      session_loss:         { icon: "⛔", color: "#CC4444", border: "#CC4444", bg: "#1A0A0A", title: "SESSION LOCKED — 2 LOSSES",    message: "Two losses this session. Done for today.",                  sub: "Your edge requires discipline. Stop here.",                         points: ["Step away now", "Log trades with honest notes", "Tomorrow you get one trade only"] },
      streak_daily_limit:   { icon: "⚠️", color: "#C9A84C", border: "#C9A84C", bg: "#1A1500", title: "ONE TRADE DONE — IN STREAK",   message: "Streak continues.",                                        sub: "Come back tomorrow. A+ only.",                                      points: ["Close MT5 now", "Log this trade honestly", "Tomorrow is one trade again until you win"] },
      streak_daily_limit_win: { icon: "✅", color: "#3DAA6A", border: "#3DAA6A", bg: "#0A1A0A", title: "STREAK BROKEN",             message: "You ended it. That took discipline.",                       sub: "Normal 2-trade rules resume tomorrow.",                             points: ["Close MT5 — don't give it back", "Log this trade in full", "Tomorrow full rules resume"] },
    }
    const content = LOCK[type] || LOCK.daily_limit
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center max-w-md w-full">
          <div className="text-6xl mb-6">{content.icon}</div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: content.color }}>{content.title}</h2>
          <p className="text-[#888888] mb-2">{content.message}</p>
          <p className="text-[#555555] text-sm mb-6">{content.sub}</p>
          <div className="rounded p-4 text-left mb-4 border" style={{ backgroundColor: content.bg, borderColor: content.border }}>
            {content.points.map((p, i) => <p key={i} className="text-sm mb-1" style={{ color: content.color }}>{i + 1}. {p}</p>)}
          </div>
        </div>
      </div>
    )
  }

  // ── STREAK WARNING ────────────────────────────────────────────────────────
  if (phase === "streak_warning") {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
        <div className="max-w-lg w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-[#C9A84C] text-xl font-bold mb-2">LOSING STREAK — {tiltStatus?.streak} IN A ROW</h2>
            <p className="text-[#888888] text-sm">You have one trade today. Make it count.</p>
          </div>
          <div className="bg-[#1A1500] border border-[#C9A84C] rounded p-5 mb-4">
            <p className="text-[#C9A84C] text-xs font-bold uppercase tracking-wider mb-3">Today's Rules</p>
            <p className="text-[#888888] text-sm mb-1">✅ A+ setups only — no exceptions</p>
            <p className="text-[#888888] text-sm mb-1">✅ One trade maximum today</p>
            <p className="text-[#888888] text-sm">✅ Win resets to 2 trades. Loss means tomorrow is also one trade.</p>
          </div>
          <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-6">
            <p className="text-[#C9A84C] text-xs font-bold uppercase tracking-wider mb-3">🧠 AI Coach</p>
            {adviceLoading
              ? <p className="text-[#444444] text-sm animate-pulse">Analysing your losses...</p>
              : <p className="text-[#CCCCCC] text-sm leading-relaxed whitespace-pre-wrap">{aiAdvice}</p>}
          </div>
          <button onClick={() => updateFlow({ phase: "setup" })}
            className="w-full py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
            I Understand — Begin Trade Analysis
          </button>
        </div>
      </div>
    )
  }

  // ── OUT OF SESSION ────────────────────────────────────────────────────────
  if (phase === "out_of_session") {
    return (
      <div className="flex items-center justify-center min-h-full p-6">
        <div className="text-center max-w-md w-full">
          <div className="text-6xl mb-6">🕐</div>
          <h2 className="text-2xl font-bold mb-3 text-[#888888]">OUT OF SESSION</h2>
          <p className="text-[#555555] mb-6">No edge exists outside London and New York. Do not trade.</p>
          <button onClick={() => updateFlow({ session: "", phase: "setup" })}
            className="w-full py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#666666] hover:text-[#999999]">
            ← Back to Setup
          </button>
        </div>
      </div>
    )
  }

  // ── SETUP ─────────────────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="p-6 max-w-2xl relative">
        {(pair || direction || session) && (
          <button onClick={handleFullReset} title="Cancel and start fresh"
            className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded text-[#444444] hover:text-[#CC4444] hover:bg-[#1A0A0A] transition-all text-lg font-bold border border-[#222222]">
            ✕
          </button>
        )}
        <div className="mb-6">
          <h2 className="text-[#C9A84C] text-2xl font-bold">Pre-Trade Checklist</h2>
          <p className="text-[#444444] text-sm mt-1">Complete this before every single entry. No exceptions.</p>
        </div>

        {tiltStatus && (
          <div className="bg-[#111111] border border-[#222222] rounded p-3 mb-4 flex justify-between text-xs">
            <span className="text-[#444444]">Trades today: <span className="text-[#C9A84C] font-bold">{tiltStatus.todayCount} / 2</span></span>
            <span className="text-[#444444]">Remaining: <span className="text-[#3DAA6A] font-bold">{tiltStatus.tradesAllowedToday}</span></span>
            {tiltStatus.streak > 0 && <span className="text-[#444444]">Loss streak: <span className="text-[#CC4444] font-bold">{tiltStatus.streak}</span></span>}
          </div>
        )}

        {tiltStatus?.streak === 1 && (
          <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-4 mb-4">
            <p className="text-[#CC4444] font-bold text-sm">⚠ 1 LOSS IN A ROW</p>
            <p className="text-[#884444] text-xs mt-1">One more loss triggers streak mode. Good setups only.</p>
          </div>
        )}

        <div className="bg-[#111111] border border-[#222222] rounded p-5 space-y-4">
          {/* Pair */}
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Pair</label>
            <div className="flex gap-2">
              {["EURUSD", "XAUUSD"].map(p => (
                <button key={p} onClick={() => setPair(p)}
                  className={`px-4 py-2 rounded text-sm font-bold transition-all ${pair === p ? "bg-[#C9A84C] text-[#0D0D0D]" : "bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Direction</label>
            <div className="flex gap-2">
              {["BUY", "SELL"].map(d => (
                <button key={d} onClick={() => setDirection(d)}
                  className={`px-6 py-2 rounded text-sm font-bold transition-all ${direction === d ? d === "BUY" ? "bg-[#3DAA6A] text-white" : "bg-[#CC4444] text-white" : "bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Session */}
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Session</label>
            <div className="flex gap-2 flex-wrap">
              {["London", "New York", "Out of Session"].map(s => (
                <button key={s} onClick={() => setSession(s)}
                  className={`px-4 py-2 rounded text-sm font-bold transition-all ${session === s ? s === "Out of Session" ? "bg-[#333333] text-[#888888] border border-[#555555]" : "bg-[#C9A84C] text-[#0D0D0D]" : s === "Out of Session" ? "bg-[#1A1A1A] text-[#444444] hover:text-[#666666] border border-[#222222]" : "bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Mood */}
          <div>
            <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Mood / Mental State (1-10)</label>
            <div className="flex items-center gap-4">
              <input type="range" min="1" max="10" value={mood} onChange={e => setMood(parseInt(e.target.value))} className="flex-1" />
              <span className={`text-lg font-bold w-8 ${mood >= 7 ? "text-[#3DAA6A]" : mood >= 4 ? "text-[#C9A84C]" : "text-[#CC4444]"}`}>{mood}</span>
            </div>
            {mood <= 3 && <p className="text-[#CC4444] text-xs mt-1">⚠ Low mood detected. A B grade setup will be auto-rejected.</p>}
          </div>
        </div>

        <button
          onClick={() => {
            if (!pair || !direction || !session) { alert("Select pair, direction and session first"); return }
            if (session === "Out of Session") { setPhase("out_of_session"); return }
            resetDecisionTree(); setPhase("interview")
          }}
          className="w-full mt-6 py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
          START TRADE ANALYSIS →
        </button>
      </div>
    )
  }

  // ── HARD STOP ─────────────────────────────────────────────────────────────
  if (phase === "interview" && hardStopped) {
    return <HardStopScreen question={hardStopped} answer={hardStopAnswer} onReset={handleFullReset} />
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  if (phase === "interview" && showSummary) {
    return (
      <AnswerSummary
        answers={treeAnswers}
        rrValue={treeValues.rr}
        liqStrength={treeAnswers.liq_strength}
        onConfirm={gradeSetup}
        onReset={handleFullReset}
      />
    )
  }

  // ── INTERVIEW — DECISION TREE ─────────────────────────────────────────────
  if (phase === "interview") {
    const node     = DECISION_TREE[currentStep]
    const options  = getNodeOptions(node)
    const progress = (currentStep / DECISION_TREE.length) * 100

    const isNoBias       = treeValues.bias === "inside" || treeValues.bias === "took_none"
    const BULLISH_BIAS_VALUES = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
    const effectiveBias  = isNoBias ? (treeValues.prev_bias || "") : treeValues.bias
    const biasDir        = BULLISH_BIAS_VALUES.includes(effectiveBias) ? "BULLISH" : "BEARISH"
    const biasMatched    = (direction === "BUY" && biasDir === "BULLISH") || (direction === "SELL" && biasDir === "BEARISH")

    return (
      <div className="flex items-center justify-center min-h-full p-6">
        <div className="w-full max-w-xl">

          <div className="flex justify-between items-center mb-6">
            <span className="text-[#444444] text-xs">{pair} {direction} — {session}</span>
            <button onClick={handleFullReset} title="Cancel"
              className="w-8 h-8 flex items-center justify-center rounded text-[#444444] hover:text-[#CC4444] hover:bg-[#1A0A0A] transition-all text-lg font-bold border border-[#222222]">
              ✕
            </button>
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
                    {parseFloat(rrInput) < 2   && <p className="text-[#CC4444] text-xs">⛔ Below 2R — hard stop</p>}
                    {parseFloat(rrInput) >= 2   && parseFloat(rrInput) < 2.5 && <p className="text-[#886600] text-xs">⚠ 2.0–2.4R — only valid if all other filters are clean</p>}
                    {parseFloat(rrInput) >= 2.5 && parseFloat(rrInput) < 3   && <p className="text-[#3DAA6A] text-xs">✓ Standard RR</p>}
                    {parseFloat(rrInput) >= 3   && <p className="text-[#C9A84C] text-xs">✓ High RR — consider partial close at first target</p>}
                  </div>
                )}
              </div>
              <button onClick={handleRrSubmit} className="w-full py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">
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
              // go back — find previous valid step
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

  // ── GRADING ───────────────────────────────────────────────────────────────
  if (phase === "grading") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🧠</div>
          <p className="text-[#C9A84C] font-bold">Grading your setup...</p>
          <p className="text-[#444444] text-sm mt-2">Running deterministic filter checks</p>
        </div>
      </div>
    )
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  if (phase === "result" && result) {
    const gradeInfo   = GRADES[result.grade] || GRADES["B"]
    const riskPct     = result.grade !== "No Trade" ? (settings?.[gradeInfo.risk] || 1) : 0
    const accountSize = settings?.account_size || 10000
    const riskAmount  = (accountSize * riskPct) / 100

    return (
      <div className="p-6 max-w-2xl">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-[#C9A84C] text-2xl font-bold">Setup Grade</h2>
            <p className="text-[#444444] text-sm mt-1">{pair} {direction} — {session} — {treeValues.rr}R planned</p>
          </div>
          <button onClick={handleFullReset} title="Start fresh"
            className="w-8 h-8 flex items-center justify-center rounded text-[#444444] hover:text-[#CC4444] hover:bg-[#1A0A0A] transition-all text-lg font-bold border border-[#222222]">
            ✕
          </button>
        </div>

        {tiltStatus?.streak >= 2 && result.grade === "B" && (
          <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-4 mb-4">
            <p className="text-[#CC4444] font-bold text-sm">⛔ STREAK MODE — A+ OR A ONLY</p>
            <p className="text-[#884444] text-xs mt-1">B grade setups are blocked. Walk away.</p>
          </div>
        )}

        {/* Grade badge */}
        <div className="rounded p-6 mb-4 border-2 text-center" style={{ backgroundColor: gradeInfo.bg, borderColor: gradeInfo.color }}>
          <div className="text-5xl font-bold mb-2" style={{ color: gradeInfo.color }}>{result.grade}</div>
          <div className="text-sm" style={{ color: gradeInfo.color }}>{gradeInfo.label}</div>
          {treeValues.rr && <div className="mt-2 text-xs" style={{ color: gradeInfo.color }}>Planned RR: {treeValues.rr}R</div>}
        </div>

        {/* AI Reasoning */}
        <div className="bg-[#111111] border border-[#222222] rounded p-4 mb-4">
          <h4 className="text-[#666666] text-xs uppercase tracking-wider mb-2">Reasoning</h4>
          <p className="text-[#CCCCCC] text-sm leading-relaxed">{result.reasoning}</p>
        </div>

        {/* Lot calculator */}
        {result.grade !== "No Trade" && (
          <div className="bg-[#111111] border border-[#222222] rounded p-4 mb-4">
            <h4 className="text-[#666666] text-xs uppercase tracking-wider mb-2">Risk & Lot Size Calculator</h4>
            <div className="flex justify-between items-center mb-3">
              <span className="text-[#C9A84C] text-2xl font-bold">{riskPct}%</span>
              <span className="text-[#888888] text-sm">${riskAmount.toFixed(2)} at risk</span>
            </div>
            <div className="bg-[#0D0D0D] rounded p-3">
              <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">Enter SL in Pips — Get Exact Lot Size</label>
              <input type="number" step="any" placeholder="e.g. 15" value={slPipsInput}
                onChange={e => setSlPipsInput(e.target.value)}
                className="w-full bg-[#111111] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C] mb-3" />
              {slPipsInput && parseFloat(slPipsInput) > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["SL Pips",       slPipsInput,                                          "#CCCCCC"],
                    ["Risk Amount",   `$${riskAmount.toFixed(2)}`,                          "#C9A84C"],
                    ["Suggested Lot", (riskAmount / (parseFloat(slPipsInput) * 10)).toFixed(2), "#C9A84C"],
                  ].map(([l, v, c]) => (
                    <div key={l} className={l === "Suggested Lot" ? "bg-[#1A1500] border border-[#C9A84C] rounded p-3 text-center" : "bg-[#111111] rounded p-3 text-center"}>
                      <div className="text-[#444444] text-xs mb-1">{l}</div>
                      <div className={`font-bold ${l === "Suggested Lot" ? "text-xl" : ""}`} style={{ color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[#444444] text-xs mt-2">{result.risk_suggestion}</p>
          </div>
        )}

        {/* Warnings */}
        {result.warnings?.length > 0 && (
          <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-4 mb-4">
            <h4 className="text-[#CC4444] text-xs uppercase tracking-wider mb-2">⚠ Warnings</h4>
            {result.warnings.map((w, i) => <p key={i} className="text-[#884444] text-sm mb-1">• {w}</p>)}
          </div>
        )}

        {/* Strengths */}
        {result.strengths?.length > 0 && (
          <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-4 mb-4">
            <h4 className="text-[#3DAA6A] text-xs uppercase tracking-wider mb-2">✓ Strengths</h4>
            {result.strengths.map((s, i) => <p key={i} className="text-[#446644] text-sm mb-1">• {s}</p>)}
          </div>
        )}

        {result.grade === "No Trade" && (
          <div className="bg-[#1A0A0A] border border-[#CC4444] rounded p-4 mb-4 text-center">
            <p className="text-[#CC4444] font-bold">Do not take this trade.</p>
            <p className="text-[#884444] text-sm mt-1">A bad trade costs more than a missed opportunity.</p>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {result.grade !== "No Trade" && (
            !journalStarted ? (
              <button onClick={handleStartJournaling}
                disabled={tiltStatus?.streak >= 2 && result.grade === "B"}
                className={`w-full py-3 rounded font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  tiltStatus?.streak >= 2 && result.grade === "B"
                    ? "bg-[#1A0A0A] border border-[#CC4444] text-[#CC4444] cursor-not-allowed opacity-60"
                    : "bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]"
                }`}>
                {tiltStatus?.streak >= 2 && result.grade === "B" ? "⛔ BLOCKED — A+ OR A ONLY IN STREAK MODE" : "📓 START JOURNALING →"}
              </button>
            ) : (
              <>
                <p className="text-[#3DAA6A] text-xs text-center mb-1">✓ Trade details sent to Journal</p>
                <button onClick={handleFullReset}
                  className="w-full py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#C9A84C] hover:bg-[#222222]">
                  START NEW TRADE ANALYSIS
                </button>
              </>
            )
          )}
          {result.grade === "No Trade" && (
            <button onClick={handleFullReset}
              className="w-full py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#666666] hover:bg-[#222222]">
              START NEW TRADE ANALYSIS
            </button>
          )}
        </div>
      </div>
    )
  }

  return null
}
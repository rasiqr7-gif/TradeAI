// ─────────────────────────────────────────────────────────────────────────────
// gradeUtils.js — single source of truth for all grading logic
// Used by both Checklist.jsx and Backtest.jsx
// AI never decides the grade. AI only writes reasoning around the computed grade.
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_ORDER = ["No Trade", "B", "A", "A+"]

function capGrade(grade, ceiling) {
  const gi = GRADE_ORDER.indexOf(grade)
  const ci = GRADE_ORDER.indexOf(ceiling)
  return GRADE_ORDER[Math.min(gi, ci)]
}

/**
 * computeGrade(treeValues, direction, mood)
 *
 * treeValues: object with keys matching DECISION_TREE node ids
 *   bias        — value string from bias node (e.g. "bullish_above", "bearish_below", etc.)
 *   scenario    — "continuation" | "reversal_cisd" | "ifvg_valid"
 *   poi_zone    — "golden" | "at_50" | "above_50"
 *   liquidity   — "clean" | "ob_justifies" | "liq_block"
 *   opposing_fvg — "none" | "disrespected" | "respected"
 *   rr          — numeric string e.g. "2.5"
 *   liq_strength — "strong" | "internal" | "none"
 *
 * direction: "BUY" | "SELL"
 * mood: number 1-10 (pass 10 for backtest — no mood captured)
 *
 * Returns: { grade, ceiling, warnings, filters }
 */
export function computeGrade(treeValues, direction, mood = 10) {
  const warnings = []
  const filters  = {}

  // ── derive bias direction from bias node value ────────────────────────────
  const BULLISH_BIAS_VALUES = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
const BEARISH_BIAS_VALUES = ["bearish_below", "bearish_fail", "both_bearish", "no_bias_prev_bearish"]

  const biasValue = treeValues.bias || ""
  const biasDir   =
    BULLISH_BIAS_VALUES.includes(biasValue) ? "BULLISH" :
    BEARISH_BIAS_VALUES.includes(biasValue) ? "BEARISH" : null

  // ── STEP 1: set grade ceiling from bias alignment + scenario ──────────────
  const biasMatched =
    (direction === "BUY"  && biasDir === "BULLISH") ||
    (direction === "SELL" && biasDir === "BEARISH")

  let ceiling = "A+"

  if (!biasMatched) {
    const scenario  = treeValues.scenario
    const isNoBias  = treeValues.bias === "inside" || treeValues.bias === "took_none"

    if (isNoBias) {
      // no-bias path — all scenarios capped at B regardless
      if (scenario === "continuation" || scenario === "continuation_ext") {
        ceiling = "B"
        warnings.push(
          "No-bias day — trading in yesterday's bias direction after liquidity sweep. Lower conviction setup. Max grade is B."
        )
      } else if (scenario === "reversal_cisd") {
        ceiling = "B"
        warnings.push(
          "No-bias day — counter to yesterday's bias with 1H CISD confirmation. Max grade is B."
        )
      } else if (scenario === "fvg_disrespected") {
        ceiling = "B"
        warnings.push(
          "No-bias day — FVG disrespect against yesterday's bias. Weakest valid justification. Max grade is B."
        )
      } else {
        return {
          grade:    "No Trade",
          ceiling:  "No Trade",
          warnings: ["No bias today and no valid scenario confirmed. No trade."],
          filters,
        }
      }
    } else {
      // normal counter-bias path
      if (scenario === "reversal_cisd") {
        ceiling = "A"
        warnings.push(
          "Counter-bias trade — going against daily bias. Valid because price swept external liquidity and gave 1H CISD reversal confirmation. Max grade is A."
        )
      } else if (scenario === "fvg_disrespected") {
        ceiling = "B"
        warnings.push(
          "Counter-bias FVG disrespect trade — price swept PDH/PDL and disrespected a strong FVG but no 1H CISD structural confirmation. Weaker justification for going against bias. Max grade is B."
        )
      } else {
        return {
          grade:    "No Trade",
          ceiling:  "No Trade",
          warnings: ["Direction contradicts daily bias with no valid reversal justification. Do not trade against bias without a sweep and structural confirmation."],
          filters,
        }
      }
    }
  }

  // ── STEP 2: score probability filters ────────────────────────────────────
  // Each filter: "pass" | "partial" | "stop"

  // F1 — POI fibonacci zone
  const poi = treeValues.poi_zone
  if (poi === "golden")        { filters.f1 = "pass" }
  else if (poi === "at_50")    { filters.f1 = "partial"; warnings.push("POI at 0.50 fib — permissible but lower probability. Golden zone (0.62–0.79) gives tighter SL and better RR room.") }
  else                          { return { grade: "No Trade", ceiling, warnings: [...warnings, "POI above 0.50 fib — trap zone. Price will fake a reaction, sweep your SL, then move. Do not enter."], filters } }

  // F2 — Liquidity above SL
  const liq = treeValues.liquidity
  if (liq === "clean")         { filters.f2 = "pass" }
  else if (liq === "ob_justifies") { filters.f2 = "partial"; warnings.push("Uncleared liquidity above SL — strong OB provides some justification but probability is reduced. You may be stopped before the move.") }
  else                          { return { grade: "No Trade", ceiling, warnings: [...warnings, "Uncleared liquidity above SL with no justification. Price will sweep it and stop you first. Stand aside."], filters } }

  // F3 — Opposing FVG in path
  const fvg = treeValues.opposing_fvg
  if (fvg === "none" || fvg === "disrespected") { filters.f3 = "pass" }
  else                          { return { grade: "No Trade", ceiling, warnings: [...warnings, "Opposing FVG is being respected between your entry and target. It will turn price back into your SL before you reach target."], filters } }

  // F4 — Bias alignment (already computed above, record it as a filter)
  if (biasMatched)              { filters.f4 = "pass" }
  else                          { filters.f4 = "partial" } // valid counter-bias (ceiling already set)

  // F5 — Risk to Reward
  const rr = parseFloat(treeValues.rr) || 0
  if (rr >= 2.5)               { filters.f5 = "pass" }
  else if (rr >= 2.0)          { filters.f5 = "partial"; warnings.push("RR between 2.0 and 2.4 — permissible only if all other filters are clean. Below 2.5 compresses your edge over time.") }
  else                          { return { grade: "No Trade", ceiling, warnings: [...warnings, "RR below 2.0 — the math does not work at your winrate. No exceptions."], filters } }

  // F6 — Liquidity strength at target
  const liqStr = treeValues.liq_strength
  if (liqStr === "strong")     { filters.f6 = "pass" }
  else if (liqStr === "internal") {
    filters.f6 = "partial"
    warnings.push("Internal liquidity at target — weaker magnetic pull. Price may stall before reaching it.")
    if (rr >= 3) warnings.push("RR of " + rr + "R claimed against internal liquidity — that target is unlikely to be reached. Recheck your TP placement.")
  }
  else                          { return { grade: "No Trade", ceiling, warnings: [...warnings, "No clear liquidity at target — your TP has no anchor. Price needs a reason to travel there. This setup has none."], filters } }

  // cross-check: 0.50 fib + high RR
  if (poi === "at_50" && rr >= 3) {
    warnings.push("0.50 fib entry with RR " + rr + "R claimed — the 0.50 fib gives less natural SL room. Verify your SL is not artificially tight to manufacture RR.")
  }

  // ── STEP 3: count passes and resolve base grade ───────────────────────────
  const passes   = Object.values(filters).filter(v => v === "pass").length
  const partials = Object.values(filters).filter(v => v === "partial").length

  let grade
  if      (passes === 6)              grade = "A+"
  else if (passes >= 5)               grade = "A"
  else if (passes >= 4 || (passes >= 3 && partials <= 2)) grade = "B"
  else                                grade = "No Trade"

  // ── STEP 4: mood demotion (live checklist only — pass mood=10 for backtest)
  if (mood <= 3 && grade === "B") {
    grade = "No Trade"
    warnings.push("Marginal setup (B grade) combined with low mental state (" + mood + "/10). Execution risk is too high — you will not manage this trade cleanly.")
  }
  if (mood <= 3 && grade !== "No Trade") {
    warnings.push("Low mental state (" + mood + "/10) — even a good setup can be ruined by poor execution. Trade with extra discipline or wait.")
  }

  // ── STEP 5: apply ceiling ─────────────────────────────────────────────────
  grade = capGrade(grade, ceiling)

  return { grade, ceiling, warnings, filters }
}

/**
 * buildAiReasoningPrompt(grade, treeValues, treeAnswers, direction, pair, session, rr, warnings, filters, isBacktest)
 * Sends the ALREADY COMPUTED grade to AI and asks only for reasoning + strengths.
 * AI cannot change the grade.
 */
export function buildAiReasoningPrompt({
  grade, treeAnswers, direction, pair, session, rr, warnings, filters, isBacktest = false
}) {
  const filterSummary = Object.entries(filters).map(([k, v]) => `${k}: ${v}`).join(", ")
  const answerSummary = Object.entries(treeAnswers).map(([k, v]) => `${k}: ${v}`).join("\n")

  return {
    system: "You are a strict forex trading coach. The grade has already been computed by a deterministic algorithm — you CANNOT change it. Your only job is to write clear, direct reasoning that explains WHY this setup received this grade, and list genuine strengths. Be specific about the setup details. Max 3 sentences for reasoning. Under 120 words total. Return only valid JSON.",
    prompt: `The grading algorithm has assigned this setup grade: ${grade}

Setup details:
Pair: ${pair}
Direction: ${direction}
Session: ${session}
Planned RR: ${rr}R
${isBacktest ? "Type: BACKTEST" : "Type: LIVE TRADE"}

Filter results (pass/partial/stop):
${filterSummary}

Trader answers:
${answerSummary}

Warnings already generated:
${warnings.join("\n") || "None"}

Your task: explain in 2-3 sentences WHY this is a ${grade} setup based on the filter results above. Then list 1-3 genuine strengths.

Return ONLY valid JSON — do NOT change the grade field:
{
  "grade": "${grade}",
  "reasoning": "2-3 sentences explaining why this grade",
  "risk_suggestion": "specific risk % suggestion",
  "warnings": ${JSON.stringify(warnings)},
  "strengths": ["strength 1", "strength 2"]
}`
  }
}

/**
 * getScenarioOptions(direction, biasValue)
 *
 * Bias-matched (BUY+BULLISH or SELL+BEARISH):
 *   Option 1 — Opened and retraced toward EQ, POI in path           → continuation   → no ceiling penalty
 *   Option 2 — Opened and continuing without retracing (no FVG/liq) → continuation_ext → no ceiling penalty
 *   Option 3 — No clear behaviour                                    → unclear         → hard stop
 *
 * Bias-against (BUY+BEARISH or SELL+BULLISH):
 *   Option 1 — Swept PDH/PDL, reversing with 1H CISD confirmed      → reversal_cisd   → ceiling A
 *   Option 2 — Swept PDH/PDL, disrespected a strong FVG (no CISD)   → fvg_disrespected → ceiling B
 *   Option 3 — No clear behaviour                                    → unclear          → hard stop
 */
export function getScenarioOptions(direction, biasValue, prevBiasValue = "") {
  const BULLISH_BIAS_VALUES = ["bullish_above", "bullish_fail", "both_bullish", "no_bias_prev_bullish"]
  const BEARISH_BIAS_VALUES = ["bearish_below", "bearish_fail", "both_bearish", "no_bias_prev_bearish"]

  const isNoBias = biasValue === "inside" || biasValue === "took_none"

  // for no-bias, resolve operative bias from previous day
  const effectiveBiasValue = isNoBias ? prevBiasValue : biasValue

  const biasDir =
    BULLISH_BIAS_VALUES.includes(effectiveBiasValue) ? "BULLISH" :
    BEARISH_BIAS_VALUES.includes(effectiveBiasValue) ? "BEARISH" : null

  const biasMatched =
    (direction === "BUY"  && biasDir === "BULLISH") ||
    (direction === "SELL" && biasDir === "BEARISH")

  if (biasMatched) {
    return [
      { label: "Opened and retraced toward EQ — POI in the path ✓", value: "continuation",     safe: true  },
      { label: "Opened and continuing without retracing to EQ ✓",   value: "continuation_ext", safe: true  },
      { label: "No clear behaviour — neither scenario confirmed",    value: "unclear",           safe: false },
    ]
  } else {
    return [
      {
        label: isNoBias
          ? "Swept PDH/PDL — reversing with 1H CISD confirmed ✓ (no-bias day — max grade B)"
          : "Swept PDH/PDL — reversing with 1H CISD confirmed ✓ (counter-bias — max grade A)",
        value: "reversal_cisd",
        safe:  true,
      },
      {
        label: isNoBias
          ? "Swept PDH/PDL — disrespected a strong FVG, no CISD (no-bias day — max grade B)"
          : "Swept PDH/PDL — disrespected a strong FVG, no CISD (counter-bias — max grade B)",
        value: "fvg_disrespected",
        safe:  true,
      },
      {
        label: "No clear behaviour — do not trade without confirmation",
        value: "unclear",
        safe:  false,
      },
    ]
  }
}
import { useState, useEffect } from "react"
import axios from "axios"

const API = "http://localhost:3001"

export default function Strategy() {
  const [rules, setRules] = useState("")
  const [conditions, setConditions] = useState([])
  const [newCondition, setNewCondition] = useState("")
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)

  useEffect(() => {
    axios.get(`${API}/api/strategy`)
      .then(r => {
        if (r.data && r.data.rules_json) {
          setRules(r.data.rules_json)
          setConditions(JSON.parse(r.data.conditions_json || "[]"))
          if (r.data.checklist_json) {
            setAnalysis(JSON.parse(r.data.checklist_json))
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function addCondition() {
    if (!newCondition.trim()) return
    setConditions([...conditions, newCondition.trim()])
    setNewCondition("")
  }

  function removeCondition(index) {
    setConditions(conditions.filter((_, i) => i !== index))
  }

  async function saveStrategy() {
    try {
      await axios.post(`${API}/api/strategy`, {
        rules_json: rules,
        conditions_json: JSON.stringify(conditions),
        checklist_json: JSON.stringify(analysis || []),
        risk_rules_json: JSON.stringify({})
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      console.error(e)
    }
  }

  async function analyzeStrategy() {
    if (!rules.trim()) {
      alert("Please enter your strategy rules first")
      return
    }
    if (conditions.length < 3) {
      alert("Add at least 3 trading conditions before analyzing")
      return
    }

    setAnalyzing(true)
    try {
      const prompt = `I am a forex trader. Here are my complete trading strategy rules:

${rules}

These are the specific conditions I have identified in my trading:
${conditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Analyze these rules and conditions. Then:
1. Define what makes an A+ setup (highest probability - all critical conditions met)
2. Define what makes an A setup (good probability - most conditions met)
3. Define what makes a B setup (lower probability - some conditions met, proceed with caution)
4. Define what is a No Trade (conditions missing that make this too risky)
5. Generate exactly 10 separate yes/no questions. Never merge two conditions into one question. Do not include any labels like HARD STOP or PROBABILITY FILTER in the question text. Questions must be plain clean yes or no questions only. Order them exactly as: session, news, bias, day framing, golden zone, liquidity, opposing FVG, CRT, CISD, RR.

Grading rules:
- A+ means questions 1 2 3 8 9 10 all yes and questions 4 5 6 7 all yes
- A means questions 1 2 3 8 9 10 all yes and 3 out of 4 remaining yes
- B means questions 1 2 3 8 9 10 all yes and 2 out of 4 remaining yes
- No Trade means any of questions 1 2 3 8 9 10 is no regardless of everything else

Return your response as valid JSON only, no explanation, in this exact format:
{
  "aplus": "description of A+ setup conditions",
  "a": "description of A setup conditions", 
  "b": "description of B setup conditions",
  "no_trade": "description of No Trade conditions",
  "questions": ["question 1", "question 2", "question 3", "question 4", "question 5", "question 6", "question 7", "question 8", "question 9", "question 10"]
}`

      const response = await axios.post(`${API}/api/ai`, {
        system: "You are a professional forex trading analyst. Analyze trading strategies and return structured JSON only. Never return anything except valid JSON.",
        prompt
      })

      let result
      try {
        const text = response.data.response
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        result = JSON.parse(jsonMatch ? jsonMatch[0] : text)
      } catch (e) {
        console.error("Parse error:", e)
        alert("AI response could not be parsed. Try again.")
        return
      }

      setAnalysis(result)

      await axios.post(`${API}/api/strategy`, {
        rules_json: rules,
        conditions_json: JSON.stringify(conditions),
        checklist_json: JSON.stringify(result),
        risk_rules_json: JSON.stringify({})
      })

    } catch (e) {
      console.error(e)
      alert("Analysis failed. Check your backend is running.")
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[#444444]">Loading strategy...</div>
    </div>
  )

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-[#C9A84C] text-2xl font-bold">Strategy Brain</h2>
        <p className="text-[#444444] text-sm mt-1">
          Your rules live here. Every AI feature reads this as permanent context.
        </p>
      </div>

      {/* Rules Input */}
      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-4">
        <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-3">
          Your Trading Rules
        </h3>
        <p className="text-[#444444] text-xs mb-3">
          Write your complete strategy in plain English. Be specific. Include entry rules, 
          exit rules, session times, pairs, risk management, and anything else that defines your edge.
        </p>
        <textarea
          value={rules}
          onChange={e => setRules(e.target.value)}
          placeholder="Example: I trade London session only (7am-10am GMT). I look for FVGs on the 15m chart when HTF (4H) trend is clearly bullish or bearish. I only enter after a liquidity sweep. My SL goes below the last swing low. I target 1:2 minimum RR. I never trade news events. I stop after 2 losses per day..."
          className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-3 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C] resize-none"
          rows={10}
        />
      </div>

      {/* Conditions Builder */}
      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-4">
        <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-3">
          Trading Conditions
        </h3>
        <p className="text-[#444444] text-xs mb-3">
          Break your strategy into specific conditions. These become your checklist criteria.
          Add at least 5-8 conditions.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            value={newCondition}
            onChange={e => setNewCondition(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCondition()}
            placeholder="e.g. HTF trend is clearly defined"
            className="flex-1 bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
          />
          <button
            onClick={addCondition}
            className="px-4 py-2 bg-[#C9A84C] text-[#0D0D0D] rounded text-sm font-bold hover:bg-[#E0BC5C]"
          >
            Add
          </button>
        </div>

        {conditions.length === 0 ? (
          <div className="text-[#333333] text-sm text-center py-4">
            No conditions added yet
          </div>
        ) : (
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center justify-between bg-[#0D0D0D] border border-[#222222] rounded px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-[#C9A84C] text-xs font-bold w-5">{i + 1}</span>
                  <span className="text-[#CCCCCC] text-sm">{c}</span>
                </div>
                <button
                  onClick={() => removeCondition(i)}
                  className="text-[#444444] hover:text-[#CC4444] text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={saveStrategy}
          className="flex-1 py-3 rounded font-bold text-sm bg-[#1A1A1A] border border-[#333333] text-[#C9A84C] hover:bg-[#222222]"
        >
          {saved ? "✓ SAVED" : "SAVE STRATEGY"}
        </button>
        <button
          onClick={analyzeStrategy}
          disabled={analyzing}
          className="flex-1 py-3 rounded font-bold text-sm bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C] disabled:opacity-50"
        >
          {analyzing ? "AI ANALYZING..." : "ANALYZE WITH AI →"}
        </button>
      </div>

      {/* AI Analysis Results */}
      {analysis && (
        <div className="bg-[#111111] border border-[#C9A84C] rounded p-5">
          <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-4">
            AI Generated Checklist
          </h3>

          <div className="space-y-3 mb-5">
            {[
              { grade: "A+", desc: analysis.aplus, color: "#C9A84C", bg: "#1A1500" },
              { grade: "A", desc: analysis.a, color: "#3DAA6A", bg: "#0A1A0A" },
              { grade: "B", desc: analysis.b, color: "#886600", bg: "#1A1000" },
              { grade: "No Trade", desc: analysis.no_trade, color: "#CC4444", bg: "#1A0A0A" },
            ].map(item => (
              <div key={item.grade} className="rounded p-3" style={{ backgroundColor: item.bg }}>
                <div className="font-bold text-sm mb-1" style={{ color: item.color }}>
                  {item.grade}
                </div>
                <div className="text-[#888888] text-xs">{item.desc}</div>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-[#666666] text-xs uppercase tracking-wider mb-3">
              Pre-Trade Questions
            </h4>
            {Array.isArray(analysis.questions) && analysis.questions.map((q, i) => (
              <div key={i} className="flex gap-3 mb-2">
                <span className="text-[#C9A84C] text-xs font-bold w-4 mt-0.5">{i + 1}</span>
                <span className="text-[#888888] text-sm">{q}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
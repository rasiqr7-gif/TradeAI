import { useState, useEffect } from "react"
import axios from "axios"
import Dashboard from "./components/Dashboard"
import Settings from "./components/Settings"
import Strategy from "./components/Strategy"
import Checklist from "./components/Checklist"
import JournalV2 from "./components/JournalV2"
import Analysis from "./components/Analysis"
import Backtest from "./components/backtest"

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "strategy", label: "Strategy", icon: "🧩" },
  { id: "backtest", label: "Backtest", icon: "🔬" },
  { id: "checklist", label: "Checklist", icon: "✅" },
  { id: "journal", label: "Journal", icon: "📓" },
  { id: "analysis", label: "Analysis", icon: "🧠" },
  { id: "settings", label: "Settings", icon: "⚙️" },
]

const CHECKLIST_INITIAL = {
  phase: "setup",
  pair: "",
  direction: "",
  session: "",
  mood: 5,
  answers: {},
  currentQ: 0,
  result: null,
  slPipsInput: "",
  journalStarted: false,
}

function Sidebar({ active, setActive, firmName }) {
  return (
    <div className="w-56 min-h-screen bg-[#111111] border-r border-[#222222] flex flex-col">
      <div className="p-6 border-b border-[#222222]">
        <h1 className="text-xl font-bold text-[#C9A84C]">TRADEAI</h1>
        <p className="text-[#444444] text-xs mt-1">Discipline System</p>
      </div>
      <nav className="flex-1 p-3">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded text-sm mb-1 transition-all ${
              active === item.id
                ? "bg-[#1A1A1A] text-[#C9A84C] border-l-2 border-[#C9A84C]"
                : "text-[#666666] hover:text-[#999999] hover:bg-[#161616]"
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-[#222222]">
        <div className="text-xs text-[#333333]">{firmName} MT5</div>
        <div className="text-xs text-[#3DAA6A] mt-1">● Connected</div>
      </div>
    </div>
  )
}

function App() {
  const [active, setActive] = useState("dashboard")
  const [firmName, setFirmName] = useState("FundedNext")
  const [checklistState, setChecklistState] = useState(CHECKLIST_INITIAL)
  const [checklistPrefill, setChecklistPrefill] = useState(null)

  useEffect(() => {
    axios.get("http://localhost:3001/api/settings")
      .then(r => { if (r.data?.funded_firm) setFirmName(r.data.funded_firm) })
      .catch(() => {})
  }, [])

  function updateChecklistState(updates) {
    setChecklistState(prev => ({ ...prev, ...updates }))
  }

  function resetChecklistState() {
    setChecklistState(CHECKLIST_INITIAL)
  }

  function handleStartJournaling(prefillData) {
    setChecklistPrefill(prefillData)
    setActive("journal")
  }

  function clearPrefill() {
    setChecklistPrefill(null)
  }

  return (
    <div className="flex min-h-screen bg-[#0D0D0D]">
      <Sidebar active={active} setActive={setActive} firmName={firmName} />
      <main className="flex-1 overflow-auto">
        {active === "dashboard" && <Dashboard />}
        {active === "strategy" && <Strategy />}
        {active === "backtest" && <Backtest />}
        {active === "checklist" && (
          <Checklist
            flowState={checklistState}
            updateFlow={updateChecklistState}
            resetFlow={resetChecklistState}
            onStartJournaling={handleStartJournaling}
          />
        )}
        {active === "journal" && (
          <JournalV2
            prefill={checklistPrefill}
            onPrefillConsumed={clearPrefill}
          />
        )}
        {active === "analysis" && <Analysis />}
        {active === "settings" && <Settings />}
      </main>
    </div>
  )
}

export default App
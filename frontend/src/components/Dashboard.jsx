import { useState, useEffect } from "react"
import axios from "axios"

const API = "http://localhost:3001"

function StatCard({ label, value, sub, color = "#C9A84C" }) {
  return (
    <div className="bg-[#111111] border border-[#222222] rounded p-4">
      <div className="text-[#444444] text-xs uppercase tracking-wider mb-2">{label}</div>
      <div className="text-2xl font-bold mb-1" style={{ color }}>{value}</div>
      {sub && <div className="text-[#444444] text-xs">{sub}</div>}
    </div>
  )
}

function DrawdownBar({ label, used, limit }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const barColor = pct < 50 ? "#3DAA6A" : pct < 80 ? "#C9A84C" : "#CC4444"
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#666666]">{label}</span>
        <span style={{ color: barColor }}>${used.toFixed(0)} / ${limit.toFixed(0)}</span>
      </div>
      <div className="h-2 bg-[#1A1A1A] rounded overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <div className="text-right text-xs mt-1" style={{ color: barColor }}>
        {pct.toFixed(1)}% used — ${(limit - used).toFixed(0)} remaining
      </div>
    </div>
  )
}

function TiltStatus({ consecutiveLosses, todayCount, todayWins, todayLosses, streakMode, streakBrokeToday }) {
  const today = new Date().toISOString().split("T")[0]

  // 2 wins today — session complete
  if (todayWins === 2) {
    return (
      <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-4">
        <div className="text-[#3DAA6A] font-bold text-sm mb-1">🏆 TWO WINS — SESSION COMPLETE</div>
        <div className="text-[#446644] text-xs">Bank it. Walk away. Come back tomorrow.</div>
      </div>
    )
  }

  // 2 losses today — session locked (normal mode)
  if (todayLosses >= 2 && !streakMode) {
    return (
      <div className="bg-[#2A0A0A] border border-[#CC4444] rounded p-4">
        <div className="text-[#CC4444] font-bold text-sm mb-1">🔴 TWO LOSSES — SESSION LOCKED</div>
        <div className="text-[#884444] text-xs">Daily limit hit. Close MT5. Come back tomorrow.</div>
      </div>
    )
  }

  // Streak broke today — that 1 win already logged, day locked
  if (streakBrokeToday && todayCount >= 1) {
    return (
      <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-4">
        <div className="text-[#3DAA6A] font-bold text-sm mb-1">✅ STREAK BROKEN — DAY LOCKED</div>
        <div className="text-[#446644] text-xs">Good. Streak is dead. Don't celebrate — you haven't recovered yet. Normal rules resume tomorrow.</div>
      </div>
    )
  }

  // Streak broke today — no trade yet, 1 allowed
  if (streakBrokeToday && todayCount === 0) {
    return (
      <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-4">
        <div className="text-[#3DAA6A] font-bold text-sm mb-1">✅ STREAK BROKEN YESTERDAY — 1 TRADE TODAY</div>
        <div className="text-[#446644] text-xs">Streak is gone. One clean trade today, then done. Normal rules tomorrow.</div>
      </div>
    )
  }

  // Streak mode — today's 1 allowed trade was a loss, locked
  if (streakMode && todayLosses >= 1) {
    return (
      <div className="bg-[#2A0A0A] border border-[#CC4444] rounded p-4">
        <div className="text-[#CC4444] font-bold text-sm mb-1">🔴 {consecutiveLosses} LOSSES IN A ROW — LOCKED</div>
        <div className="text-[#884444] text-xs">Your one trade today was a loss. Close MT5. Come back tomorrow. A+ only.</div>
      </div>
    )
  }

  // Streak mode — fresh day, 1 trade allowed
  if (streakMode && todayCount === 0) {
    return (
      <div className="bg-[#2A1A00] border border-[#C9A84C] rounded p-4">
        <div className="text-[#C9A84C] font-bold text-sm mb-1">⚠ {consecutiveLosses} CONSECUTIVE LOSSES — 1 TRADE ONLY</div>
        <div className="text-[#886644] text-xs">One A+ setup. Nothing forced. One clean win ends this.</div>
      </div>
    )
  }

  // Normal — 1 loss today
  if (todayLosses === 1) {
    return (
      <div className="bg-[#1A0A0A] border border-[#884444] rounded p-4">
        <div className="text-[#CC4444] font-bold text-sm mb-1">⚠ 1 LOSS TODAY</div>
        <div className="text-[#884444] text-xs">One trade left. Stay disciplined.</div>
      </div>
    )
  }

  // Normal — 2 trades done, mixed result
  if (todayCount >= 2) {
    return (
      <div className="bg-[#1A1500] border border-[#C9A84C] rounded p-4">
        <div className="text-[#C9A84C] font-bold text-sm mb-1">✅ DAILY LIMIT REACHED</div>
        <div className="text-[#886644] text-xs">Two trades done. Session over. Log and rest.</div>
      </div>
    )
  }

  // All clear
  return (
    <div className="bg-[#0A1A0A] border border-[#3DAA6A] rounded p-4">
      <div className="text-[#3DAA6A] font-bold text-sm mb-1">🟢 CLEAR TO TRADE</div>
      <div className="text-[#446644] text-xs">Discipline intact. Max 2 trades today.</div>
    </div>
  )
}

export default function Dashboard() {
  const [settings, setSettings] = useState(null)
  const [trades, setTrades] = useState([])
  const [allTrades, setAllTrades] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [s, t, r] = await Promise.all([
          axios.get(`${API}/api/settings`),
          axios.get(`${API}/api/trades/today`),
          axios.get(`${API}/api/trades`)
        ])
        setSettings(s.data)
        setTrades(t.data)
        setAllTrades(r.data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#444444]">Loading dashboard...</div>
      </div>
    )
  }

  const today = new Date().toISOString().split("T")[0]
  const accountSize = settings?.account_size || 5000
  const dailyLimitPct = settings?.daily_loss_limit_pct || 5
  const maxDrawdownPct = settings?.max_drawdown_pct || 10
  const dailyLimit = (accountSize * dailyLimitPct) / 100
  const maxDrawdown = (accountSize * maxDrawdownPct) / 100

  const commission = parseFloat(localStorage.getItem("tradeai_commission")) || 0
  const todayPnl = trades.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0)
  const todayLoss = Math.abs(Math.min(todayPnl, 0))
  const pnlColor = todayPnl >= 0 ? "#3DAA6A" : "#CC4444"
  const allTimePnl = allTrades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0) - commission
  const allTimeLoss = Math.abs(Math.min(allTimePnl, 0))
  
  const todayCount = trades.length
  const todayWins = trades.filter(t => parseFloat(t.pips) > 0).length
  const todayLosses = trades.filter(t => parseFloat(t.pips) < 0).length
  const wins = trades.filter(t => parseFloat(t.pips) > 0).length
  const losses = trades.filter(t => parseFloat(t.pips) < 0).length
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : 0

  // Count consecutive losses from newest trade backwards
  const consecutiveLosses = (() => {
    let count = 0
    for (const t of allTrades) {
      if (parseFloat(t.pips) < 0) count++
      else break
    }
    return count
  })()

  // Streak mode: most recent trade is a loss AND consecutive losses >= 2
  const streakMode = consecutiveLosses >= 2

  // Streak broke today: allTrades[0] is a win dated today, and before it there were 2+ losses
  const streakBrokeToday = (() => {
    if (allTrades.length === 0) return false
    const latest = allTrades[0]
    if (latest.date !== today) return false
    if (parseFloat(latest.pips) <= 0) return false
    // Check if there were 2+ consecutive losses before this win
    let prevLosses = 0
    for (let i = 1; i < allTrades.length; i++) {
      if (parseFloat(allTrades[i].pips) < 0) prevLosses++
      else break
    }
    return prevLosses >= 2
  })()



  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[#C9A84C] text-2xl font-bold">Dashboard</h2>
          <p className="text-[#444444] text-sm mt-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[#444444] text-xs">Account</div>
          <div className="text-[#C9A84C] font-bold">${accountSize.toLocaleString()}</div>
          <div className="text-[#444444] text-xs">{settings?.funded_firm || "Personal account"}</div>
        </div>
      </div>

      <div className="mb-6">
        <TiltStatus
          consecutiveLosses={consecutiveLosses}
          todayCount={todayCount}
          todayWins={todayWins}
          todayLosses={todayLosses}
          streakMode={streakMode}
          streakBrokeToday={streakBrokeToday}
        />
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Today P&L"
          value={`${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}`}
          sub={`${trades.length} trades today`}
          color={pnlColor}
        />
        <StatCard
          label="Win Rate"
          value={`${winRate}%`}
          sub={`${wins}W / ${losses}L`}
          color="#C9A84C"
        />
        <StatCard
  label="Trades Today"
  value={`${todayCount} / ${streakMode || streakBrokeToday ? 1 : 2}`}
  sub={
    streakMode || streakBrokeToday
      ? todayCount >= 1 ? "Limit reached" : "1 trade only"
      : todayCount >= 2 ? "Limit reached" : `${2 - todayCount} remaining`
  }
  color={
    streakMode || streakBrokeToday
      ? todayCount >= 1 ? "#CC4444" : "#C9A84C"
      : todayCount >= 2 ? "#CC4444" : "#3DAA6A"
  }
/>
        <StatCard
          label="Daily Limit Left"
          value={`$${(dailyLimit - todayLoss).toFixed(0)}`}
          sub={`Limit: $${dailyLimit.toFixed(0)}`}
          color={todayLoss > dailyLimit * 0.8 ? "#CC4444" : "#3DAA6A"}
        />
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-6">
        <h3 className="text-[#C9A84C] font-bold text-sm uppercase tracking-wider mb-4">Drawdown Monitor</h3>
        <DrawdownBar label="Daily Loss" used={todayLoss} limit={dailyLimit} />
        <DrawdownBar label="Max Drawdown (All Time)" used={allTimeLoss} limit={maxDrawdown} />
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded p-5">
        <h3 className="text-[#C9A84C] font-bold text-sm uppercase tracking-wider mb-4">Today's Trades</h3>
        {trades.length === 0 ? (
          <div className="text-[#333333] text-sm text-center py-8">No trades today</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#444444] text-xs uppercase border-b border-[#222222]">
                <th className="text-left pb-2">Pair</th>
                <th className="text-left pb-2">Dir</th>
                <th className="text-left pb-2">Grade</th>
                <th className="text-left pb-2">Pips</th>
                <th className="text-left pb-2">P&L</th>
                <th className="text-left pb-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id} className="border-b border-[#1A1A1A]">
                  <td className="py-2 text-[#CCCCCC]">{t.pair}</td>
                  <td className="py-2 text-[#888888]">{t.direction}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      t.grade === "A+" ? "bg-[#1A1500] text-[#C9A84C]" :
                      t.grade === "A" ? "bg-[#0A1A0A] text-[#3DAA6A]" :
                      t.grade === "B" ? "bg-[#1A1000] text-[#886600]" :
                      "bg-[#1A0A0A] text-[#CC4444]"
                    }`}>{t.grade || "—"}</span>
                  </td>
                  <td className="py-2 text-[#888888]">{t.pips || "—"}</td>
                  <td className="py-2" style={{ color: (parseFloat(t.pnl) || 0) >= 0 ? "#3DAA6A" : "#CC4444" }}>
                    {t.pnl ? `$${parseFloat(t.pnl).toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2">
                    <span style={{ color: parseFloat(t.pips) > 0 ? "#3DAA6A" : "#CC4444" }}>
                      {parseFloat(t.pips) > 0 ? "WIN" : parseFloat(t.pips) < 0 ? "LOSS" : "BE"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
import { useState, useEffect } from "react"
import axios from "axios"

const API = "http://localhost:3001"

export default function Settings() {
  const [form, setForm] = useState({
    account_size: 10000,
    daily_loss_limit_pct: 5,
    max_drawdown_pct: 10,
    default_risk_aplus: 1.5,
    default_risk_a: 1.0,
    default_risk_b: 0.5,
    funded_firm: "Personal account"
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get(`${API}/api/settings`)
      .then(r => { if (r.data) setForm(r.data) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSave() {
    try {
      await axios.post(`${API}/api/settings`, form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[#444444]">Loading settings...</div>
    </div>
  )

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-[#C9A84C] text-2xl font-bold">Settings</h2>
        <p className="text-[#444444] text-sm mt-1">
          Configure your account and risk parameters
        </p>
      </div>

      {/* Account Settings */}
      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-4">
        <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-4">
          Account
        </h3>

        <div className="mb-4">
          <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">
            Broker / Account Name
          </label>
          <input
            name="funded_firm"
            value={form.funded_firm}
            onChange={handleChange}
            className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
          />
        </div>


        <div className="mb-4">
          <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">
            Account Size ($)
          </label>
          <input
            name="account_size"
            type="number"
            value={form.account_size}
            onChange={handleChange}
            className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
          />
        </div>
      </div>

      {/* Risk Limits */}
      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-4">
        <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-4">
          Drawdown Limits
        </h3>
       
        <div className="mb-4">
          <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">
            Daily Loss Limit (%)
          </label>
          <input
            name="daily_loss_limit_pct"
            type="number"
            step="any"
            value={form.daily_loss_limit_pct}
            onChange={handleChange}
            className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
          />
          <p className="text-[#333333] text-xs mt-1">
            Your own daily loss limit: the most you accept losing in one day
          </p>
        </div>

        <div className="mb-4">
          <label className="text-[#666666] text-xs uppercase tracking-wider block mb-2">
            Max Drawdown (%)
          </label>
          <input
            name="max_drawdown_pct"
            type="number"
            step="any"
            value={form.max_drawdown_pct}
            onChange={handleChange}
            className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
          />
          <p className="text-[#333333] text-xs mt-1">
            Your own maximum drawdown: the most you accept losing in total
          </p>
        </div>
      </div>

      {/* Risk Per Trade */}
      <div className="bg-[#111111] border border-[#222222] rounded p-5 mb-6">
        <h3 className="text-[#C9A84C] text-sm font-bold uppercase tracking-wider mb-4">
          Risk Per Trade (%)
        </h3>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[#3DAA6A] text-xs uppercase tracking-wider block mb-2">
              A+ Setup
            </label>
            <input
              name="default_risk_aplus"
              type="number"
              step="any"
              value={form.default_risk_aplus}
              onChange={handleChange}
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#3DAA6A]"
            />
          </div>
          <div>
            <label className="text-[#C9A84C] text-xs uppercase tracking-wider block mb-2">
              A Setup
            </label>
            <input
              name="default_risk_a"
              type="number"
              step="any"
              value={form.default_risk_a}
              onChange={handleChange}
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
            />
          </div>
          <div>
            <label className="text-[#886600] text-xs uppercase tracking-wider block mb-2">
              B Setup
            </label>
            <input
              name="default_risk_b"
              type="number"
              step="any"
              value={form.default_risk_b}
              onChange={handleChange}
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-3 rounded font-bold text-sm transition-all bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]"
      >
        {saved ? "✓ SAVED" : "SAVE SETTINGS"}
      </button>
    </div>
  )
}
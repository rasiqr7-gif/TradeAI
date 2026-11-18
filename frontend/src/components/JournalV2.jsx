import { useState, useEffect, useRef } from "react"
import axios from "axios"

const API = "http://localhost:3001"
const MAX_SS = 5

const POI_OPTIONS = ["FVG", "BB", "OB", "IFVG", "LIQ SWEEP", "MB"]
const EXECUTION_REVIEW_OPTIONS = [
  "STABLE", "FOGS", "FEAR", "GREED", "FOMO",
  "Wrong side of probability", "Method mistake", "Psychological mistake"
]
const SESSION_OPTIONS = ["LONDON", "NY AM", "NY PM", "OUT OF SESSION"]

function calcPnl(pips, lot) { return (parseFloat(pips)||0)*(parseFloat(lot)||0)*10 }
function getRiskAmount(grade, settings) {
  const size = settings?.account_size || 5000
  if (grade==="A+") return (size*(settings?.default_risk_aplus||1))/100
  if (grade==="A")  return (size*(settings?.default_risk_a||0.75))/100
  if (grade==="B")  return (size*(settings?.default_risk_b||0.5))/100
  return 0
}
function parsePaths(val) {
  if (!val) return []
  try { const a = JSON.parse(val); if (Array.isArray(a)) return a } catch {}
  return val.split(',').filter(Boolean).map(s => s.trim())
}

function MultiSelect({ options, value=[], onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt} onClick={() => {
          const n = value.includes(opt) ? value.filter(v=>v!==opt) : [...value, opt]
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
              <button onClick={e=>{e.stopPropagation();setZoom((zoom-1+paths.length)%paths.length)}}
                className="absolute left-4 text-white text-3xl bg-black bg-opacity-50 px-3 py-1 rounded">◀</button>
              <button onClick={e=>{e.stopPropagation();setZoom((zoom+1)%paths.length)}}
                className="absolute right-4 text-white text-3xl bg-black bg-opacity-50 px-3 py-1 rounded">▶</button>
              <div className="absolute bottom-4 text-white text-sm">{zoom+1} / {paths.length}</div>
            </>
          )}
        </div>
      )}
      <div className={`grid gap-2 ${paths.length===1?"grid-cols-1":paths.length===2?"grid-cols-2":"grid-cols-3"}`}>
        {paths.map((p, i) => (
          <img key={i} src={`${API}/screenshots/${p}`} alt={`ss-${i+1}`}
            className="w-full rounded border border-[#222222] cursor-zoom-in object-cover"
            style={{maxHeight:"180px"}} onClick={() => setZoom(i)} />
        ))}
      </div>
      {paths.length > 1 && <p className="text-[#444444] text-xs mt-1 text-center">Click any image to fullscreen · Arrow keys to navigate</p>}
    </>
  )
}

function CalendarView({ trades }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const year = currentMonth.getFullYear(), month = currentMonth.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const tradesByDate = {}
  trades.forEach(t => { if (!tradesByDate[t.date]) tradesByDate[t.date]=[]; tradesByDate[t.date].push(t) })
  const days = []
  for (let i=0;i<firstDay;i++) days.push(null)
  for (let i=1;i<=daysInMonth;i++) days.push(i)
  return (
    <div className="bg-[#111111] border border-[#222222] rounded p-5">
      <div className="flex justify-between items-center mb-5">
        <button onClick={()=>setCurrentMonth(new Date(year,month-1))} className="text-[#666666] hover:text-[#C9A84C] px-3 py-1 text-lg">◀</button>
        <span className="text-[#C9A84C] font-bold text-lg">{currentMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>
        <button onClick={()=>setCurrentMonth(new Date(year,month+1))} className="text-[#666666] hover:text-[#C9A84C] px-3 py-1 text-lg">▶</button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
          <div key={d} className="text-center text-[#444444] text-sm py-2 font-bold">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day,i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`
          const dt = tradesByDate[dateStr]||[]
          // calendar uses net pnl per trade
          const pnl = dt.reduce((s,t)=>{
            const gross = parseFloat(t.pnl)||0
            const charges = parseFloat(t.charges)||0
            const net = t.net_pnl != null ? parseFloat(t.net_pnl) : gross - charges
            return s + net
          },0)
          const today = new Date()
          const isToday = today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===day
          return (
            <div key={day} className={`rounded p-2 min-h-16 ${isToday?"border-2 border-[#C9A84C]":"border border-[#1A1A1A]"} ${dt.length>0?(pnl>0?"bg-[#0A1A0A]":pnl<0?"bg-[#1A0A0A]":"bg-[#1A1A1A]"):"bg-[#0D0D0D]"}`}>
              <div className="text-sm text-[#444444] text-right mb-1">{day}</div>
              {dt.length>0&&(
                <>
                  <div className="text-sm font-bold text-center" style={{color:pnl>=0?"#3DAA6A":"#CC4444"}}>{pnl>=0?"+":""}${pnl.toFixed(0)}</div>
                  <div className="text-xs text-[#555555] text-center">{dt.length} trade{dt.length>1?"s":""}</div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TradeForm({ onSave, onCancel, settings, prefill }) {
  const [form, setForm] = useState(() => ({
    date:      new Date().toISOString().split("T")[0],
    pair:      prefill?.pair      || "EURUSD",
    session:   prefill?.session   || "LONDON",
    bias:      prefill?.bias      || (prefill?.direction === "BUY" ? "BULLISH" : prefill?.direction === "SELL" ? "BEARISH" : "BULLISH"),
    poi:       [],
    planned_rr: prefill?.planned_rr || "",
    direction: prefill?.direction || "BUY",
    sl_pips:   prefill?.sl_pips   || "",
    lot:       prefill?.lot       || "",
    pips:      "",
    charges:   "",
    execution_review: [],
    notes:     prefill?.checklistNotes || "",
    grade:     prefill?.grade     || "A",
  }))
  const fileRef = useRef()
  const [screenshots, setScreenshots] = useState([])

  function set(key, val) { setForm(f=>({...f,[key]:val})) }

  const pips=parseFloat(form.pips)||0, slPips=parseFloat(form.sl_pips)||0, lot=parseFloat(form.lot)||0
  const achievedRr = slPips>0 ? (pips/slPips).toFixed(2) : "—"
  const grossPnl = calcPnl(pips,lot)
  const charges = parseFloat(form.charges)||0
  const netPnl = grossPnl
  const riskAmount = getRiskAmount(form.grade,settings)
  const biasAlignment = form.bias&&form.direction
    ? ((form.bias==="BULLISH"&&form.direction==="BUY")||(form.bias==="BEARISH"&&form.direction==="SELL"))?"✅ ALIGNED":"❌ MISALIGNED":"—"
  const discipline = form.execution_review.includes("STABLE")?"✅ DISCIPLINED"
    :form.execution_review.some(e=>["FOMO","GREED","FEAR"].includes(e))?"❌ EMOTIONAL":"⚠️ REVIEW"
  const result = pips>0?"WIN":pips<0?"LOSS":form.pips!==""?"BE":"—"

  async function handleSave() {
    if (!form.pair||!form.direction){alert("Pair and direction required");return}
    const finalPips=parseFloat(form.pips)||0, finalSlPips=parseFloat(form.sl_pips)||0, finalLot=parseFloat(form.lot)||0
    const finalCharges=parseFloat(form.charges)||0
    let screenshotPaths = []
    if (screenshots.length > 0) {
      const fd = new FormData()
      screenshots.forEach(f => fd.append("screenshots", f))
      const res = await axios.post(`${API}/api/upload/multi`, fd, {headers:{"Content-Type":"multipart/form-data"}})
      screenshotPaths = res.data.filenames
    }
    const grossP = calcPnl(finalPips,finalLot)
    const trade = {
      ...form,
      poi: JSON.stringify(form.poi),
      execution_review: JSON.stringify(form.execution_review),
      achieved_rr: finalSlPips>0 ? (finalPips/finalSlPips).toFixed(2) : 0,
      bias_alignment: ((form.bias==="BULLISH"&&form.direction==="BUY")||(form.bias==="BEARISH"&&form.direction==="SELL"))?"ALIGNED":"MISALIGNED",
      discipline: form.execution_review.includes("STABLE")?"DISCIPLINED":form.execution_review.some(e=>["FOMO","GREED","FEAR"].includes(e))?"EMOTIONAL":"REVIEW",
      result: finalPips>0?"win":finalPips<0?"loss":"breakeven",
      pnl: grossP,
      charges: finalCharges,
      net_pnl: grossP - finalCharges,
      screenshot_path: screenshotPaths.length>0 ? JSON.stringify(screenshotPaths) : null
    }
    onSave(trade)
  }

  const hasPrefill = !!(prefill?.pair)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-5 border-b border-[#222222]">
          <div>
            <h3 className="text-[#C9A84C] font-bold text-xl">Log Trade</h3>
            {hasPrefill && (
              <p className="text-[#3DAA6A] text-xs mt-1">✓ Pre-filled from Checklist — complete remaining fields</p>
            )}
          </div>
          <button onClick={onCancel} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[#666666] text-sm block mb-2">Date</label>
              <input type="date" value={form.date} onChange={e=>set("date",e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
            </div>
            <div>
              <label className="text-[#666666] text-sm block mb-2">Pair</label>
              <div className="flex gap-2">
                {["EURUSD","XAUUSD"].map(p=>(
                  <button key={p} onClick={()=>set("pair",p)}
                    className={`flex-1 py-2 rounded text-sm font-bold ${form.pair===p?"bg-[#C9A84C] text-[#0D0D0D]":"bg-[#1A1A1A] text-[#555555]"}`}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Session</label>
            <div className="flex gap-2 flex-wrap">
              {SESSION_OPTIONS.map(s=>(
                <button key={s} onClick={()=>set("session",s)}
                  className={`px-4 py-2 rounded text-sm font-bold ${form.session===s?"bg-[#C9A84C] text-[#0D0D0D]":"bg-[#1A1A1A] text-[#555555]"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Bias</label>
            <div className="flex gap-2">
              {["BULLISH","BEARISH"].map(b=>(
                <button key={b} onClick={()=>set("bias",b)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.bias===b?b==="BULLISH"?"bg-[#3DAA6A] text-white":"bg-[#CC4444] text-white":"bg-[#1A1A1A] text-[#555555]"}`}>{b}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">POI</label>
            <MultiSelect options={POI_OPTIONS} value={form.poi} onChange={val=>set("poi",val)} />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Planned RR</label>
            <input type="number" step="any" value={form.planned_rr} onChange={e=>set("planned_rr",e.target.value)}
              placeholder="e.g. 2.5" className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Execution</label>
            <div className="flex gap-2">
              {["BUY","SELL"].map(d=>(
                <button key={d} onClick={()=>set("direction",d)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.direction===d?d==="BUY"?"bg-[#3DAA6A] text-white":"bg-[#CC4444] text-white":"bg-[#1A1A1A] text-[#555555]"}`}>{d}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[{key:"sl_pips",label:"SL Pips"},{key:"lot",label:"Lot"},{key:"pips",label:"Pips (+win / -loss)"}].map(f=>(
              <div key={f.key}>
                <label className="text-[#666666] text-sm block mb-2">{f.label}</label>
                <input type="number" step="any" value={form[f.key]} onChange={e=>set(f.key,e.target.value)}
                  className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C]" />
              </div>
            ))}
          </div>

          {/* ── Broker Charges ── */}
          <div>
            <label className="text-[#666666] text-sm block mb-2">
              Broker Charges <span className="text-[#444444] font-normal">(FundedNext fee per trade, $)</span>
            </label>
            <input type="number" step="any" value={form.charges} onChange={e=>set("charges",e.target.value)}
              placeholder="e.g. 3.50"
              className="w-full bg-[#0D0D0D] border border-[#CC4444] rounded px-3 py-2 text-[#CC4444] font-bold text-sm focus:outline-none focus:border-[#C9A84C]" />
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
            <textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3}
              placeholder="What happened? Why did you take this trade?"
              className="w-full bg-[#0D0D0D] border border-[#333333] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none focus:border-[#C9A84C] resize-none" />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Execution Review</label>
            <MultiSelect options={EXECUTION_REVIEW_OPTIONS} value={form.execution_review} onChange={val=>set("execution_review",val)} />
          </div>
          <div>
            <label className="text-[#666666] text-sm block mb-2">Setup Grade</label>
            <div className="flex gap-2">
              {["A+","A","B","No Trade"].map(g=>(
                <button key={g} onClick={()=>set("grade",g)}
                  className={`flex-1 py-2 rounded text-sm font-bold ${form.grade===g?g==="A+"?"bg-[#C9A84C] text-[#0D0D0D]":g==="A"?"bg-[#3DAA6A] text-white":g==="B"?"bg-[#886600] text-white":"bg-[#CC4444] text-white":"bg-[#1A1A1A] text-[#555555]"}`}>{g}</button>
              ))}
            </div>
          </div>
          <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded p-4">
            <div className="text-[#444444] text-xs uppercase tracking-wider mb-3 font-bold">Auto Calculated</div>
            <div className="grid grid-cols-3 gap-3">
              {[
                {label:"Risk Amount",value:`$${riskAmount.toFixed(2)}`,color:"#C9A84C"},
                {label:"P&L",value:(charges>0||grossPnl!==0)?`$${netPnl.toFixed(2)}`:"—",color:netPnl>=0?"#3DAA6A":"#CC4444"},
                {label:"Achieved RR",value:achievedRr,color:"#C9A84C"},
                {label:"Bias Alignment",value:biasAlignment,color:biasAlignment.includes("ALIGNED")&&!biasAlignment.includes("MIS")?"#3DAA6A":"#CC4444"},
                {label:"Discipline",value:discipline,color:discipline.includes("DISC")?"#3DAA6A":discipline.includes("EMOT")?"#CC4444":"#886600"},
                {label:"Result",value:result,color:result==="WIN"?"#3DAA6A":result==="LOSS"?"#CC4444":"#888888"},
              ].map(item=>(
                <div key={item.label} className="text-center">
                  <div className="text-[#444444] text-xs mb-1">{item.label}</div>
                  <div className="text-sm font-bold" style={{color:item.color}}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 flex gap-3 border-t border-[#222222]">
          <button onClick={onCancel} className="flex-1 py-3 rounded text-sm text-[#666666] border border-[#333333]">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-3 rounded text-sm font-bold bg-[#C9A84C] text-[#0D0D0D] hover:bg-[#E0BC5C]">Save Trade</button>
        </div>
      </div>
    </div>
  )
}

// ── TRADE DETAIL — P&L + Charges shown separately ──────────────
function TradeDetail({ trade, onClose, onDelete, onNotesSaved, onScreenshotsUpdated, onChargesUpdated, settings }) {
  if (!trade) return null
  let poi=[], er=[]
  try{poi=JSON.parse(trade.poi||"[]")}catch{}
  try{er=JSON.parse(trade.execution_review||"[]")}catch{}
  const riskAmount = getRiskAmount(trade.grade, settings)

  const [ssPaths, setSsPaths]           = useState(parsePaths(trade.screenshot_path))
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesVal, setNotesVal]         = useState(trade.notes||"")
  const [saving, setSaving]             = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingSS, setAddingSS]         = useState(false)
  const [newSS, setNewSS]               = useState([])
  const [ssUploading, setSsUploading]   = useState(false)
  const ssRef = useRef()

  const [editingCharges, setEditingCharges] = useState(false)
  const [chargesVal, setChargesVal]         = useState(trade.charges != null ? String(trade.charges) : "")
  const [savingCharges, setSavingCharges]   = useState(false)

  async function saveNotes() {
    setSaving(true)
    try {
      await axios.patch(`${API}/api/trades/${trade.id}/notes`, { notes: notesVal })
      onNotesSaved(trade.id, notesVal)
      setEditingNotes(false)
    } catch(e){console.error(e)}
    finally{setSaving(false)}
  }

  async function saveCharges() {
    setSavingCharges(true)
    try {
      const charges = parseFloat(chargesVal)||0
      const gross = parseFloat(trade.pnl)||0
      const net_pnl = gross - charges
      await axios.patch(`${API}/api/trades/${trade.id}/charges`, { charges, net_pnl })
      onChargesUpdated(trade.id, charges, net_pnl)
      setEditingCharges(false)
    } catch(e){console.error(e)}
    finally{setSavingCharges(false)}
  }

  async function uploadNewScreenshots() {
    if (newSS.length === 0) return
    setSsUploading(true)
    try {
      const fd = new FormData()
      newSS.forEach(f => fd.append("screenshots", f))
      const res = await axios.patch(`${API}/api/trades/${trade.id}/screenshots`, fd, {
        headers: { "Content-Type": "multipart/form-data" }
      })
      const updated = parsePaths(res.data.screenshot_path)
      setSsPaths(updated)
      onScreenshotsUpdated(trade.id, res.data.screenshot_path)
      setNewSS([])
      setAddingSS(false)
    } catch(e){console.error(e)}
    finally{setSsUploading(false)}
  }

  const grossPnl    = parseFloat(trade.pnl)||0
  const netPnl = grossPnl

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-6">
      <div className="bg-[#111111] border border-[#333333] rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-5 border-b border-[#222222]">
          <div>
            <h3 className="text-[#C9A84C] font-bold text-xl">{trade.pair} — {trade.direction}</h3>
            <p className="text-[#444444] text-sm mt-1">{trade.date} · {trade.session}</p>
          </div>
          <div className="flex items-center gap-3">
            {!confirmDelete ? (
              <button onClick={()=>setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs font-bold text-[#CC4444] border border-[#CC4444] rounded hover:bg-[#CC4444] hover:text-white transition-all">
                🗑 Delete
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={()=>onDelete(trade.id)}
                  className="px-3 py-1.5 text-xs font-bold bg-[#CC4444] text-white rounded">Confirm</button>
                <button onClick={()=>setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#888888] rounded">Cancel</button>
              </div>
            )}
            <button onClick={onClose} className="text-[#444444] hover:text-[#CCCCCC] text-2xl">✕</button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[["Pair",trade.pair],["Session",trade.session],["Bias",trade.bias],
              ["POI",poi.join(", ")||"—"],["Planned RR",trade.planned_rr],["Execution",trade.direction],
              ["SL Pips",trade.sl_pips],["Lot",trade.lot],["Pips",trade.pips],["Grade",trade.grade]
            ].map(([l,v])=>(
              <div key={l} className="bg-[#0D0D0D] rounded p-3">
                <div className="text-[#444444] text-xs mb-1">{l}</div>
                <div className="text-[#CCCCCC] text-sm font-bold">{v||"—"}</div>
              </div>
            ))}
          </div>

          {/* ── Broker Charges — editable ── */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[#444444] text-sm font-bold">Broker Charges</div>
              {!editingCharges && (
                <button onClick={()=>setEditingCharges(true)} className="text-[#C9A84C] text-xs hover:underline">✏ Edit</button>
              )}
            </div>
            {editingCharges ? (
              <div className="flex gap-2 items-center">
                <span className="text-[#444444] text-sm">$</span>
                <input type="number" step="any" value={chargesVal}
                  onChange={e=>setChargesVal(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-[#0D0D0D] border border-[#CC4444] rounded px-3 py-2 text-[#CC4444] font-bold text-sm focus:outline-none" />
                <button onClick={saveCharges} disabled={savingCharges}
                  className="px-4 py-2 text-xs font-bold bg-[#C9A84C] text-[#0D0D0D] rounded disabled:opacity-50">
                  {savingCharges?"Saving...":"Save"}
                </button>
                <button onClick={()=>{setEditingCharges(false);setChargesVal(trade.charges!=null?String(trade.charges):"")}}
                  className="px-4 py-2 text-xs font-bold bg-[#1A1A1A] text-[#666666] rounded">Cancel</button>
              </div>
            ) : (
              <div className="bg-[#0D0D0D] rounded p-3">
                <span className="text-[#CC4444] font-bold text-sm">
                  {trade.charges != null && parseFloat(trade.charges) > 0 ? `-$${parseFloat(trade.charges).toFixed(2)}` : <span className="text-[#333333]">Not set — click Edit to add</span>}
                </span>
              </div>
            )}
          </div>

          {/* ── Screenshots with post-trade upload ── */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[#444444] text-sm font-bold">
                Screenshots {ssPaths.length > 0 && <span className="text-[#555555] font-normal">({ssPaths.length}/{MAX_SS})</span>}
              </div>
              {ssPaths.length < MAX_SS && !addingSS && (
                <button onClick={() => setAddingSS(true)}
                  className="text-[#C9A84C] text-xs hover:underline">+ Add SS</button>
              )}
            </div>
            <ScreenshotGallery paths={ssPaths} />
            {addingSS && (
              <div className="mt-3 bg-[#0D0D0D] border border-[#333333] rounded p-3">
                <p className="text-[#666666] text-xs mb-2">Add up to {MAX_SS - ssPaths.length} more screenshot{MAX_SS - ssPaths.length !== 1 ? "s" : ""}</p>
                <input type="file" accept="image/*" multiple ref={ssRef}
                  onChange={e => {
                    const files = Array.from(e.target.files)
                    setNewSS(prev => [...prev, ...files].slice(0, MAX_SS - ssPaths.length))
                    e.target.value = ""
                  }}
                  className="w-full text-[#666666] text-sm mb-2" />
                {newSS.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {newSS.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 bg-[#0A1A0A] px-2 py-1 rounded">
                        <span className="text-[#3DAA6A] text-xs">{f.name.slice(0, 20)}</span>
                        <button onClick={() => setNewSS(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[#CC4444] text-xs ml-1">✕</button>
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

          {/* ── Notes — editable ── */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[#444444] text-sm font-bold">Notes</div>
              {!editingNotes && (
                <button onClick={()=>setEditingNotes(true)} className="text-[#C9A84C] text-xs hover:underline">✏ Edit</button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea value={notesVal} onChange={e=>setNotesVal(e.target.value)} rows={4}
                  className="w-full bg-[#0D0D0D] border border-[#C9A84C] rounded px-3 py-2 text-[#CCCCCC] text-sm focus:outline-none resize-none mb-2" />
                <div className="flex gap-2">
                  <button onClick={saveNotes} disabled={saving}
                    className="px-4 py-1.5 text-xs font-bold bg-[#C9A84C] text-[#0D0D0D] rounded disabled:opacity-50">
                    {saving?"Saving...":"Save Notes"}
                  </button>
                  <button onClick={()=>{setEditingNotes(false);setNotesVal(trade.notes||"")}}
                    className="px-4 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#666666] rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-[#888888] text-sm bg-[#0D0D0D] rounded p-3 leading-relaxed min-h-[40px]">
                {notesVal || <span className="text-[#333333]">No notes</span>}
              </p>
            )}
          </div>

          {er.length>0 && (
            <div>
              <div className="text-[#444444] text-sm mb-2 font-bold">Execution Review</div>
              <div className="flex gap-2 flex-wrap">
                {er.map(e=>(
                  <span key={e} className={`px-3 py-1 text-sm rounded font-bold ${
                    e==="STABLE"?"bg-[#0A1A0A] text-[#3DAA6A]":["FOMO","GREED","FEAR"].includes(e)?"bg-[#1A0A0A] text-[#CC4444]":"bg-[#1A1A1A] text-[#888888]"
                  }`}>{e}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Stats grid: P&L and Charges shown separately ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Risk Amount",`$${riskAmount.toFixed(2)}`,"#C9A84C"],
              ["P&L", trade.pnl ? `$${netPnl.toFixed(2)}` : "—", netPnl >= 0 ? "#3DAA6A" : "#CC4444"],
              ["Charges", trade.charges != null && parseFloat(trade.charges) > 0 ? `-$${parseFloat(trade.charges).toFixed(2)}` : "—", "#CC4444"],
              ["Achieved RR",trade.achieved_rr,"#C9A84C"],
              ["Bias Alignment",trade.bias_alignment,trade.bias_alignment==="ALIGNED"?"#3DAA6A":"#CC4444"],
              ["Discipline",trade.discipline,trade.discipline==="DISCIPLINED"?"#3DAA6A":"#CC4444"],
              ["Result",parseFloat(trade.pips)>0?"WIN":parseFloat(trade.pips)<0?"LOSS":"BE",parseFloat(trade.pips)>0?"#3DAA6A":"#CC4444"],
            ].map(([l,v,c])=>(
              <div key={l} className="bg-[#0D0D0D] rounded p-3">
                <div className="text-[#444444] text-xs mb-1">{l}</div>
                <div className="text-sm font-bold" style={{color:c}}>{v||"—"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function JournalV2({ prefill, onPrefillConsumed }) {
  const [trades, setTrades]               = useState([])
  const [settings, setSettings]           = useState(null)
  const [loading, setLoading]             = useState(true)
  const [showForm, setShowForm]           = useState(false)
  const [activePrefill, setActivePrefill] = useState(null)
  const [selectedTrade, setSelectedTrade] = useState(null)
  const [view, setView]                   = useState("table")
  const [filter, setFilter]               = useState("all")
  const [adjust, setAdjust] = useState(() => parseFloat(localStorage.getItem("tradeai_adjust"))||0)

  useEffect(() => {
    if (prefill) {
      setActivePrefill(prefill)
      setShowForm(true)
      if (onPrefillConsumed) onPrefillConsumed()
    }
  }, [prefill])

  async function loadTrades() {
    try {
      const [r, s] = await Promise.all([axios.get(`${API}/api/trades`), axios.get(`${API}/api/settings`)])
      const sorted = [...r.data].sort((a, b) => new Date(b.date) - new Date(a.date))
      setTrades(sorted); setSettings(s.data)
    } catch(e){console.error(e)}
    finally{setLoading(false)}
  }
  useEffect(()=>{loadTrades()},[])

  async function saveTrade(form) {
    try {
      await axios.post(`${API}/api/trades`, form)
      setShowForm(false); setActivePrefill(null); loadTrades()
    } catch(e){console.error(e)}
  }

  function handleCancelForm() { setShowForm(false); setActivePrefill(null) }

  async function deleteTrade(id) {
    try {
      await axios.delete(`${API}/api/trades/${id}`)
      setSelectedTrade(null); loadTrades()
    } catch(e){console.error(e)}
  }

  function handleNotesSaved(id, notes) {
    setTrades(prev => prev.map(t => t.id===id ? {...t, notes} : t))
    setSelectedTrade(prev => prev?.id===id ? {...prev, notes} : prev)
  }

  function handleScreenshotsUpdated(id, screenshot_path) {
    setTrades(prev => prev.map(t => t.id===id ? {...t, screenshot_path} : t))
    setSelectedTrade(prev => prev?.id===id ? {...prev, screenshot_path} : prev)
  }

  function handleChargesUpdated(id, charges, net_pnl) {
    setTrades(prev => prev.map(t => t.id===id ? {...t, charges, net_pnl} : t))
    setSelectedTrade(prev => prev?.id===id ? {...prev, charges, net_pnl} : prev)
  }

  const filtered = trades.filter(t => {
    if (filter==="all") return true
    if (filter==="win") return parseFloat(t.pips)>0
    if (filter==="loss") return parseFloat(t.pips)<0
    if (filter==="aplus") return t.grade==="A+"
    if (filter==="london") return t.session==="LONDON"
    if (filter==="ny") return t.session?.includes("NY")
    return true
  })

  const totalGrossPnl = trades.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0)
  const totalCharges  = trades.reduce((s,t)=>s+(parseFloat(t.charges)||0),0)
  // Overall P&L = gross - per-trade charges - manual adjust
  const overallPnl = totalGrossPnl - totalCharges - (parseFloat(adjust)||0)

  const wins     = trades.filter(t=>parseFloat(t.pips)>0).length
  const losses   = trades.filter(t=>parseFloat(t.pips)<0).length
  const winRate  = trades.length>0?((wins/trades.length)*100).toFixed(0):0
  const closedTrades = trades.filter(t => t.achieved_rr !== null && t.achieved_rr !== 0 && t.achieved_rr !== "0")
  const avgRR = closedTrades.length > 0
    ? (closedTrades.reduce((s,t) => s + (parseFloat(t.achieved_rr)||0), 0) / closedTrades.length).toFixed(2)
    : 0

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-[#444444]">Loading journal...</div></div>

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden",padding:"20px"}}>
      {selectedTrade && (
        <TradeDetail
          trade={selectedTrade} settings={settings}
          onClose={()=>setSelectedTrade(null)}
          onDelete={deleteTrade}
          onNotesSaved={handleNotesSaved}
          onScreenshotsUpdated={handleScreenshotsUpdated}
          onChargesUpdated={handleChargesUpdated}
        />
      )}
      {showForm && (
        <TradeForm onSave={saveTrade} onCancel={handleCancelForm} settings={settings} prefill={activePrefill} />
      )}

      <div className="flex justify-between items-center mb-4" style={{flexShrink:0}}>
        <div>
          <h2 className="text-[#C9A84C] text-2xl font-bold">Trade Journal</h2>
          <p className="text-[#444444] text-sm mt-1">Every trade. Honest. Permanent.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Adjust box */}
          <div className="bg-[#111111] border border-[#333333] rounded px-3 py-2 flex items-center gap-2" title="Manual adjust for small rounding differences vs broker statement">
            <span className="text-[#444444] text-xs uppercase tracking-wider">Adjust</span>
            <span className="text-[#444444] text-xs">$</span>
            <input
              type="number" step="any" value={adjust}
              onChange={e => { setAdjust(e.target.value); localStorage.setItem("tradeai_adjust", e.target.value) }}
              placeholder="0"
              className="bg-transparent text-[#886600] font-bold text-sm w-20 focus:outline-none"
            />
          </div>
          <button onClick={()=>{ setActivePrefill(null); setShowForm(true) }}
            className="px-5 py-2 bg-[#C9A84C] text-[#0D0D0D] rounded text-sm font-bold hover:bg-[#E0BC5C]">
            + Log Trade
          </button>
        </div>
      </div>

      {/* Stats bar — Adjust shown inline, single P&L */}
      <div className="grid grid-cols-5 gap-3 mb-4" style={{flexShrink:0}}>
        {[
          {label:"Total Trades", value:trades.length,          color:"#C9A84C"},
          {label:"Win Rate",     value:`${winRate}%`,          color:parseFloat(winRate)>=50?"#3DAA6A":"#CC4444"},
          {label:"Wins / Losses",value:`${wins} / ${losses}`,  color:"#C9A84C"},
          {label:"Avg RR",       value:avgRR,                  color:"#C9A84C"},
          {label:"P&L",          value:`$${overallPnl.toFixed(2)}`, color:overallPnl>=0?"#3DAA6A":"#CC4444"},
        ].map(s=>(
          <div key={s.label} className="bg-[#111111] border border-[#222222] rounded p-4">
            <div className="text-[#444444] text-sm mb-1">{s.label}</div>
            <div className="text-xl font-bold" style={{color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center mb-3 flex-wrap gap-2" style={{flexShrink:0}}>
        <div className="flex gap-2 flex-wrap">
          {[{key:"all",label:"All"},{key:"win",label:"Wins"},{key:"loss",label:"Losses"},
            {key:"aplus",label:"A+ Only"},{key:"london",label:"London"},{key:"ny",label:"New York"}].map(f=>(
            <button key={f.key} onClick={()=>setFilter(f.key)}
              className={`px-4 py-1.5 rounded text-sm font-bold transition-all ${filter===f.key?"bg-[#C9A84C] text-[#0D0D0D]":"bg-[#1A1A1A] text-[#666666] hover:text-[#999999]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[{key:"table",label:"📋 Table"},{key:"calendar",label:"📅 Calendar"}].map(v=>(
            <button key={v.key} onClick={()=>setView(v.key)}
              className={`px-4 py-1.5 rounded text-sm font-bold ${view===v.key?"bg-[#C9A84C] text-[#0D0D0D]":"bg-[#1A1A1A] text-[#666666]"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{flex:1,overflow:"hidden",minHeight:0}}>
        {view==="calendar" ? (
          <div style={{height:"100%",overflowY:"auto"}}><CalendarView trades={trades} /></div>
        ) : (
          <div className="bg-[#111111] border border-[#222222] rounded" style={{height:"100%",overflow:"auto"}}>
            {filtered.length===0 ? (
              <div className="text-center py-16 text-[#333333]">
                <div className="text-4xl mb-3">📓</div>
                <p className="text-sm">No trades logged yet</p>
              </div>
            ) : (
              <table className="text-sm" style={{whiteSpace:"nowrap",borderCollapse:"collapse",width:"max-content",minWidth:"100%"}}>
                <thead style={{position:"sticky",top:0,zIndex:10,background:"#0D0D0D"}}>
                  <tr className="border-b border-[#222222] text-[#555555] uppercase text-xs">
                    {["Date","Pair","Session","Bias","POI","Planned RR","Execution","SL Pips","Lot","Pips",
                      "Risk Amount","P&L","Achieved RR","Bias Alignment","Discipline","Result","SS","Notes","Execution Review"
                    ].map(h=><th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t=>{
                    const pips=parseFloat(t.pips)||0, isWin=pips>0, isLoss=pips<0
                    let poi=[], er=[]
                    try{poi=JSON.parse(t.poi||"[]")}catch{}
                    try{er=JSON.parse(t.execution_review||"[]")}catch{}
                    const riskAmount=getRiskAmount(t.grade,settings)
                    const ssPaths=parsePaths(t.screenshot_path)
                    const grossPnl=parseFloat(t.pnl)||0
                    const tradeNetPnl = grossPnl
                    return (
                      <tr key={t.id} onClick={()=>setSelectedTrade(t)}
                        className="border-b border-[#1A1A1A] cursor-pointer hover:bg-[#161616] transition-all">
                        <td className="px-4 py-3 text-[#888888]">{t.date}</td>
                        <td className="px-4 py-3 text-[#CCCCCC] font-bold">{t.pair}</td>
                        <td className="px-4 py-3 text-[#888888]">{t.session}</td>
                        <td className="px-4 py-3 font-bold" style={{color:t.bias==="BULLISH"?"#3DAA6A":"#CC4444"}}>{t.bias||"—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {poi.length>0?poi.map(p=>(
                              <span key={p} className="px-2 py-0.5 bg-[#1A1500] text-[#C9A84C] rounded text-xs font-bold">{p}</span>
                            )):<span className="text-[#333333]">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#888888]">{t.planned_rr||"—"}</td>
                        <td className="px-4 py-3 font-bold" style={{color:t.direction==="BUY"?"#3DAA6A":"#CC4444"}}>{t.direction}</td>
                        <td className="px-4 py-3 text-[#888888]">{t.sl_pips||"—"}</td>
                        <td className="px-4 py-3 text-[#888888]">{t.lot||"—"}</td>
                        <td className="px-4 py-3 font-bold" style={{color:isWin?"#3DAA6A":isLoss?"#CC4444":"#888888"}}>
                          {pips!==0?(pips>0?`+${t.pips}`:t.pips):"—"}
                        </td>
                        <td className="px-4 py-3 text-[#C9A84C] font-bold">${riskAmount.toFixed(2)}</td>
                        {/* Single P&L column = net (gross - charges) */}
                        <td className="px-4 py-3 font-bold" style={{color:tradeNetPnl>=0?"#3DAA6A":"#CC4444"}}>
                          {t.pnl?`$${tradeNetPnl.toFixed(2)}`:"—"}
                        </td>
                        <td className="px-4 py-3 text-[#C9A84C] font-bold">{t.achieved_rr||"—"}</td>
                        <td className="px-4 py-3 font-bold" style={{color:t.bias_alignment==="ALIGNED"?"#3DAA6A":"#CC4444"}}>{t.bias_alignment||"—"}</td>
                        <td className="px-4 py-3 font-bold" style={{color:t.discipline==="DISCIPLINED"?"#3DAA6A":t.discipline==="EMOTIONAL"?"#CC4444":"#886600"}}>{t.discipline||"—"}</td>
                        <td className="px-4 py-3 font-bold" style={{color:isWin?"#3DAA6A":isLoss?"#CC4444":"#888888"}}>{isWin?"WIN":isLoss?"LOSS":"BE"}</td>
                        <td className="px-4 py-3 text-center">
                          {ssPaths.length>0
                            ? <span className="text-[#3DAA6A] text-xs font-bold">📸 {ssPaths.length}</span>
                            : <span className="text-[#333333]">—</span>}
                        </td>
                        <td className="px-4 py-3 text-[#555555]" style={{maxWidth:"200px"}}>
                          <span title={t.notes}>{t.notes?t.notes.slice(0,30)+(t.notes.length>30?"...":""):"—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {er.length>0?er.map(e=>(
                              <span key={e} className={`px-2 py-0.5 rounded text-xs font-bold ${e==="STABLE"?"bg-[#0A1A0A] text-[#3DAA6A]":["FOMO","GREED","FEAR"].includes(e)?"bg-[#1A0A0A] text-[#CC4444]":"bg-[#1A1A1A] text-[#666666]"}`}>{e}</span>
                            )):<span className="text-[#333333]">—</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
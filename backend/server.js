
const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const Groq = require('groq-sdk')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
// Screenshots
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'screenshots')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => { cb(null, `${Date.now()}-${file.originalname}`) }
})
const upload = multer({ storage })
const db = require('./database')
const { startBackupScheduler } = require('./backup')

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')))

app.get('/api/health', (req, res) => {
  res.json({ status: 'TradeAI backend running', model: process.env.GROQ_MODEL, provider: 'Groq' });
});

app.post('/api/ai', async (req, res) => {
  const { system, prompt, history = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  try {
    const messages = [
      { role: 'system', content: system || 'You are a professional trading analysis assistant.' },
      ...history,
      { role: 'user', content: prompt }
    ];
    const response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL, messages, temperature: 0.3, max_tokens: 1024
    });
    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error('Groq error:', error.message);
    res.status(500).json({ error: 'AI service failed: ' + error.message });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM settings LIMIT 1').get() || {}) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.post('/api/settings', (req, res) => {
  try {
    const t = req.body
    db.prepare(`
      UPDATE settings SET account_size=@account_size, daily_loss_limit_pct=@daily_loss_limit_pct,
        max_drawdown_pct=@max_drawdown_pct, default_risk_aplus=@default_risk_aplus,
        default_risk_a=@default_risk_a, default_risk_b=@default_risk_b,
        funded_firm=@funded_firm, updated_at=CURRENT_TIMESTAMP WHERE id=1
    `).run({
      account_size: parseFloat(t.account_size)||5000, daily_loss_limit_pct: parseFloat(t.daily_loss_limit_pct)||5,
      max_drawdown_pct: parseFloat(t.max_drawdown_pct)||10, default_risk_aplus: parseFloat(t.default_risk_aplus)||1,
      default_risk_a: parseFloat(t.default_risk_a)||0.75, default_risk_b: parseFloat(t.default_risk_b)||0.5,
      funded_firm: t.funded_firm||'FundedNext'
    })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// Trades
app.get('/api/trades', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM trades ORDER BY created_at DESC').all()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.get('/api/trades/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    res.json(db.prepare('SELECT * FROM trades WHERE date = ? ORDER BY created_at DESC').all(today))
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ── POST /api/trades — now saves charges + net_pnl ──
app.post('/api/trades', async (req, res) => {
  try {
    const t = req.body
    const pnl = t.pnl !== undefined && t.pnl !== null && t.pnl !== "" ? parseFloat(t.pnl) : (parseFloat(t.pips)||0)*(parseFloat(t.lot)||0)*10
    const charges = parseFloat(t.charges) || 0
    const net_pnl = pnl - charges
    const result = db.prepare(`
      INSERT INTO trades (date,pair,direction,bias,session,grade,poi,planned_rr,sl_pips,lot,pips,
        achieved_rr,execution_review,notes,bias_alignment,discipline,result,pnl,charges,net_pnl,screenshot_path)
      VALUES (@date,@pair,@direction,@bias,@session,@grade,@poi,@planned_rr,@sl_pips,@lot,@pips,
        @achieved_rr,@execution_review,@notes,@bias_alignment,@discipline,@result,@pnl,@charges,@net_pnl,@screenshot_path)
    `).run({
      date: t.date||new Date().toISOString().split("T")[0], pair:t.pair||"", direction:t.direction||"",
      bias:t.bias||"", session:t.session||"", grade:t.grade||"", poi:t.poi||"[]",
      planned_rr:parseFloat(t.planned_rr)||0, sl_pips:parseFloat(t.sl_pips)||0,
      lot:parseFloat(t.lot)||0, pips:parseFloat(t.pips)||0, achieved_rr:parseFloat(t.achieved_rr)||0,
      execution_review:t.execution_review||"[]", notes:t.notes||"", bias_alignment:t.bias_alignment||"",
      discipline:t.discipline||"", result:t.result||"", pnl, charges, net_pnl,
      screenshot_path:t.screenshot_path||null
    })
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) { console.error("Trade save error:", error.message); res.status(500).json({ error: error.message }) }
})

app.delete('/api/trades/:id', (req, res) => {
  try {
    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id)
    if (!trade) return res.status(404).json({ error: 'Not found' })
    if (trade.screenshot_path) {
      trade.screenshot_path.split(',').filter(Boolean).forEach(p => {
        const f = path.join(__dirname, 'screenshots', p.trim())
        if (fs.existsSync(f)) fs.unlinkSync(f)
      })
    }
    db.prepare('DELETE FROM trades WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.patch('/api/trades/:id/notes', (req, res) => {
  try {
    db.prepare('UPDATE trades SET notes = ? WHERE id = ?').run(req.body.notes||'', req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ── PATCH /api/trades/:id/charges — update broker charges + recalculate net_pnl ──
app.patch('/api/trades/:id/charges', (req, res) => {
  try {
    const { charges, net_pnl } = req.body
    db.prepare('UPDATE trades SET charges = ?, net_pnl = ? WHERE id = ?')
      .run(parseFloat(charges)||0, parseFloat(net_pnl)||0, req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.patch('/api/trades/:id/screenshots', upload.array('screenshots', 5), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' })
    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(req.params.id)
    if (!trade) return res.status(404).json({ error: 'Not found' })
    const existing = trade.screenshot_path ? JSON.parse(trade.screenshot_path) : []
    const combined = [...existing, ...req.files.map(f => f.filename)].slice(0, 5)
    db.prepare('UPDATE trades SET screenshot_path = ? WHERE id = ?').run(JSON.stringify(combined), req.params.id)
    res.json({ success: true, screenshot_path: JSON.stringify(combined) })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.patch('/api/backtest/:id/screenshots', upload.array('screenshots', 5), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' })
    const trade = db.prepare('SELECT * FROM backtest_trades WHERE id = ?').get(req.params.id)
    if (!trade) return res.status(404).json({ error: 'Not found' })
    const existing = trade.screenshot_path ? JSON.parse(trade.screenshot_path) : []
    const combined = [...existing, ...req.files.map(f => f.filename)].slice(0, 5)
    db.prepare('UPDATE backtest_trades SET screenshot_path = ? WHERE id = ?').run(JSON.stringify(combined), req.params.id)
    res.json({ success: true, screenshot_path: JSON.stringify(combined) })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// Strategy
app.get('/api/strategy', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM strategy ORDER BY created_at DESC LIMIT 1').get() || {}) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.post('/api/strategy', (req, res) => {
  try {
    const { rules_json, checklist_json, risk_rules_json, conditions_json } = req.body
    const result = db.prepare(`
      INSERT INTO strategy (rules_json,checklist_json,risk_rules_json,conditions_json)
      VALUES (@rules_json,@checklist_json,@risk_rules_json,@conditions_json)
    `).run({ rules_json:rules_json||"", checklist_json:checklist_json||"", risk_rules_json:risk_rules_json||"", conditions_json:conditions_json||"" })
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// Backtest
app.get('/api/backtest', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM backtest_trades ORDER BY created_at DESC').all()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.post('/api/backtest', (req, res) => {
  try {
    const t = req.body
    const pnl = t.pnl !== undefined && t.pnl !== null && t.pnl !== "" ? parseFloat(t.pnl) : (parseFloat(t.pips)||0)*(parseFloat(t.lot)||0)*10
    const result = db.prepare(`
      INSERT INTO backtest_trades (date,pair,direction,bias,session,grade,planned_rr,sl_pips,lot,pips,
        achieved_rr,pnl,result,conditions_json,notes,execution_review,bias_alignment,discipline,
        screenshot_path,would_take_live,hindsight_bias)
      VALUES (@date,@pair,@direction,@bias,@session,@grade,@planned_rr,@sl_pips,@lot,@pips,
        @achieved_rr,@pnl,@result,@conditions_json,@notes,@execution_review,@bias_alignment,@discipline,
        @screenshot_path,@would_take_live,@hindsight_bias)
    `).run({
      date:t.date||"", pair:t.pair||"", direction:t.direction||"", bias:t.bias||"",
      session:t.session||"", grade:t.grade||"", planned_rr:parseFloat(t.planned_rr)||0,
      sl_pips:parseFloat(t.sl_pips)||0, lot:parseFloat(t.lot)||0, pips:parseFloat(t.pips)||0,
      achieved_rr:parseFloat(t.achieved_rr)||0, pnl, result:t.result||"",
      conditions_json:t.conditions_json||"[]", notes:t.notes||"", execution_review:t.execution_review||"[]",
      bias_alignment:t.bias_alignment||"", discipline:t.discipline||"",
      screenshot_path:t.screenshot_path||null,
      would_take_live:t.would_take_live!==undefined?t.would_take_live:null,
      hindsight_bias:t.hindsight_bias!==undefined?t.hindsight_bias:null,
    })
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) { res.status(500).json({ error: error.message }) }
})
app.delete('/api/backtest/:id', (req, res) => {
  try {
    const trade = db.prepare('SELECT * FROM backtest_trades WHERE id = ?').get(req.params.id)
    if (!trade) return res.status(404).json({ error: 'Not found' })
    if (trade.screenshot_path) {
      trade.screenshot_path.split(',').filter(Boolean).forEach(p => {
        const f = path.join(__dirname, 'screenshots', p.trim())
        if (fs.existsSync(f)) fs.unlinkSync(f)
      })
    }
    db.prepare('DELETE FROM backtest_trades WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})
app.patch('/api/backtest/:id/notes', (req, res) => {
  try {
    db.prepare('UPDATE backtest_trades SET notes = ? WHERE id = ?').run(req.body.notes||'', req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// Sessions
app.get('/api/session/latest', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').get() || {}) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.post('/api/session', (req, res) => {
  try {
    const t = req.body
    const result = db.prepare(`
      INSERT INTO sessions (date,mood,daily_loss_limit,max_trades,walk_away_trigger,contract_signed)
      VALUES (@date,@mood,@daily_loss_limit,@max_trades,@walk_away_trigger,@contract_signed)
    `).run({
      date:t.date||new Date().toISOString().split('T')[0], mood:parseInt(t.mood)||5,
      daily_loss_limit:parseFloat(t.daily_loss_limit)||0, max_trades:parseInt(t.max_trades)||3,
      walk_away_trigger:t.walk_away_trigger||"", contract_signed:t.contract_signed?1:0
    })
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/journal/auto', (req, res) => {
  try {
    const t = req.body
    const pnl = (parseFloat(t.pips)||0)*(parseFloat(t.lot)||0)*(t.pair==="XAUUSD"?1:0.1)*100
    const result = db.prepare(`
      INSERT INTO trades (date,pair,direction,session,grade,pips,lot,pnl,notes,result)
      VALUES (@date,@pair,@direction,@session,@grade,@pips,@lot,@pnl,@notes,@result)
    `).run({
      date:t.date||new Date().toISOString().split('T')[0], pair:t.pair||"", direction:t.direction||"",
      session:t.session||"", grade:t.grade||"", pips:parseFloat(t.pips)||0,
      lot:parseFloat(t.lot)||0, pnl, notes:t.notes||"", result:t.result||""
    })
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/upload', upload.single('screenshot'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ filename: req.file.filename })
})
// Multi upload — up to 5 screenshots
app.post('/api/upload/multi', upload.array('screenshots', 5), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' })
  res.json({ filenames: req.files.map(f => f.filename) })
})

app.listen(port, () => {
  console.log(`TradeAI backend running on port ${port}`)
  console.log(`AI Model: ${process.env.GROQ_MODEL}`)
  console.log(`Provider: Groq (Free tier)`)
  startBackupScheduler()
})
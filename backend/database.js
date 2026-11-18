const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, 'tradeai.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    pair TEXT,
    direction TEXT,
    bias TEXT,
    session TEXT,
    grade TEXT,
    poi TEXT,
    planned_rr REAL,
    sl_pips REAL,
    lot REAL,
    pips REAL,
    achieved_rr REAL,
    execution_review TEXT,
    notes TEXT,
    bias_alignment TEXT,
    discipline TEXT,
    result TEXT,
    pnl REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_size REAL DEFAULT 5000,
    daily_loss_limit_pct REAL DEFAULT 5,
    max_drawdown_pct REAL DEFAULT 10,
    default_risk_aplus REAL DEFAULT 1,
    default_risk_a REAL DEFAULT 0.75,
    default_risk_b REAL DEFAULT 0.5,
    funded_firm TEXT DEFAULT 'FundedNext',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS strategy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER DEFAULT 1,
    rules_json TEXT,
    checklist_json TEXT,
    risk_rules_json TEXT,
    conditions_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    mood INTEGER,
    daily_loss_limit REAL,
    max_trades INTEGER,
    walk_away_trigger TEXT,
    contract_signed INTEGER DEFAULT 0,
    tilt_triggered INTEGER DEFAULT 0,
    consecutive_losses INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS backtest_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    pair TEXT,
    direction TEXT,
    result TEXT,
    pips REAL,
    conditions_json TEXT,
    grade TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS analysis_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT,
    content_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

const existingSettings = db.prepare('SELECT id FROM settings LIMIT 1').get()
if (!existingSettings) {
  db.prepare(`
    INSERT INTO settings (account_size, daily_loss_limit_pct, max_drawdown_pct, default_risk_aplus, default_risk_a, default_risk_b, funded_firm)
    VALUES (5000, 5, 10, 1, 0.75, 0.5, 'FundedNext')
  `).run()
}
function addMissingColumns(table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
  }
}

addMissingColumns('trades', {
  charges: 'REAL DEFAULT 0',
  net_pnl: 'REAL',
  screenshot_path: 'TEXT'
})

addMissingColumns('backtest_trades', {
  bias: 'TEXT',
  session: 'TEXT',
  planned_rr: 'REAL',
  sl_pips: 'REAL',
  lot: 'REAL',
  achieved_rr: 'REAL',
  pnl: 'REAL',
  execution_review: 'TEXT',
  bias_alignment: 'TEXT',
  discipline: 'TEXT',
  screenshot_path: 'TEXT',
  would_take_live: 'INTEGER',
  hindsight_bias: 'TEXT'
})
module.exports = db

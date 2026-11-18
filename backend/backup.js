const fs   = require('fs')
const path = require('path')

// ── Config ────────────────────────────────────────────────────
const DB_PATH     = path.join(__dirname, 'tradeai.db')
const BACKUP_DIR  = path.join(__dirname, '..', 'backups')
const KEEP_DAILY  = 30   // keep last 30 daily backups
const KEEP_WEEKLY = 12   // keep last 12 weekly backups
const INTERVAL_MS = 24 * 60 * 60 * 1000  // every 24 hours

// ── Run backup ────────────────────────────────────────────────
function runBackup() {
  try {
    fs.mkdirSync(path.join(BACKUP_DIR, 'daily'),  { recursive: true })
    fs.mkdirSync(path.join(BACKUP_DIR, 'weekly'), { recursive: true })

    const now       = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dayOfWeek = now.getDay() // 0 = Sunday

    // Daily backup
    const dailyFile = path.join(BACKUP_DIR, 'daily', `tradeai_${timestamp}.db`)
    fs.copyFileSync(DB_PATH, dailyFile)
    console.log(`[BACKUP] Daily backup saved: ${dailyFile}`)

    // Weekly backup on Sunday
    if (dayOfWeek === 0) {
      const weeklyFile = path.join(BACKUP_DIR, 'weekly', `tradeai_weekly_${timestamp}.db`)
      fs.copyFileSync(DB_PATH, weeklyFile)
      console.log(`[BACKUP] Weekly backup saved: ${weeklyFile}`)
      pruneOldFiles(path.join(BACKUP_DIR, 'weekly'), KEEP_WEEKLY)
    }

    pruneOldFiles(path.join(BACKUP_DIR, 'daily'), KEEP_DAILY)

  } catch (err) {
    console.error('[BACKUP] Failed:', err.message)
  }
}

// ── Delete oldest files beyond limit ─────────────────────────
function pruneOldFiles(dir, keepCount) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)

  files.slice(keepCount).forEach(f => {
    fs.unlinkSync(path.join(dir, f.name))
    console.log(`[BACKUP] Pruned old backup: ${f.name}`)
  })
}

// ── Start ─────────────────────────────────────────────────────
function startBackupScheduler() {
  console.log('[BACKUP] Scheduler started — runs every 24 hours')
  console.log(`[BACKUP] Saving to: ${BACKUP_DIR}`)
  runBackup() // run immediately on startup
  setInterval(runBackup, INTERVAL_MS)
}

module.exports = { startBackupScheduler }
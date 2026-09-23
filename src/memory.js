'use strict'

const fs = require('fs')
const path = require('path')

/*
 * The bot's memory, kept in data/memory.json:
 *   seen      id -> { t: first-seen ms, s: 1 if sent, st: street }
 *   state     lastSuccessAt, lastLapAt, sentTotal
 *
 * Failsafes:
 *   - atomic writes (tmp file + rename): a crash mid-write can't corrupt it
 *   - a corrupt file is moved to memory.json.bad-<time> and the .bak is used
 *   - entries older than MEMORY_DAYS are pruned, total capped at MEMORY_MAX
 */
module.exports = (filePath, opts = {}) => {
  const days = Number(opts.days || process.env.MEMORY_DAYS || 30)
  const max = Number(opts.max || process.env.MEMORY_MAX || 50000)
  const bak = filePath + '.bak'

  let db = { seen: {}, state: {} }

  const read = f => {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!raw || typeof raw !== 'object' || typeof raw.seen !== 'object') throw new Error('bad shape')
    return { seen: raw.seen || {}, state: raw.state || {} }
  }

  if (fs.existsSync(filePath)) {
    try {
      db = read(filePath)
    } catch (err) {
      const bad = `${filePath}.bad-${Date.now()}`
      console.error(`[memory] ${filePath} unreadable (${err.message}) - kept as ${path.basename(bad)}`)
      try { fs.renameSync(filePath, bad) } catch (e) {}
      if (fs.existsSync(bak)) {
        try { db = read(bak); console.log('[memory] restored from backup') } catch (e) {
          console.error('[memory] backup unreadable too - starting empty')
        }
      }
    }
  }

  const prune = () => {
    const cutoff = Date.now() - days * 86400000
    let ids = Object.keys(db.seen)
    ids.forEach(id => { if ((db.seen[id].t || 0) < cutoff) delete db.seen[id] })
    ids = Object.keys(db.seen)
    if (ids.length > max) {
      ids.sort((a, b) => db.seen[a].t - db.seen[b].t)
        .slice(0, ids.length - max).forEach(id => delete db.seen[id])
    }
  }

  let dirty = false
  const save = () => {
    if (!dirty) return
    try {
      prune()
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const tmp = filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(db))
      fs.renameSync(tmp, filePath)
      fs.copyFileSync(filePath, bak) // last known-good copy
      dirty = false
    } catch (err) {
      console.error(`[memory] cannot write ${filePath}: ${err.message}`)
    }
  }

  return {
    size: () => Object.keys(db.seen).length,
    has: id => Object.prototype.hasOwnProperty.call(db.seen, String(id)),
    wasSent: id => !!(db.seen[String(id)] && db.seen[String(id)].s),
    remember: (id, info = {}) => {
      const k = String(id)
      db.seen[k] = Object.assign({ t: Date.now() }, db.seen[k], info)
      dirty = true
    },
    get: key => db.state[key],
    set: (key, value) => { db.state[key] = value; dirty = true },
    save
  }
}

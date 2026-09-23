'use strict'

const loaded = require('./config').load()
if (loaded) {
  console.log(`[config] read ${loaded.count} setting(s) from ${loaded.file}`)
} else {
  console.error('\n[config] No config.txt. Rename config.example.txt to config.txt and fill it in.\n')
  process.exit(1)
}

const fs = require('fs')
const path = require('path')

const waze = require('./waze')
const { fromFeatures, reason, resolvePlace, countryAllowed, pointOf, editors, allowedCountries } = require('./closures')
const buildMessage = require('./message')
const telegram = require('./telegram')
const makeMemory = require('./memory')
const geofence = require('./geofence')
const commands = require('./commands')

const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'data')
const lockPath = path.join(dataDir, 'bot.lock')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const num = (k, d) => Number(process.env[k] || d)

/* ---- failsafe: only one copy running --------------------------------------- */
const takeLock = () => {
  fs.mkdirSync(dataDir, { recursive: true })
  if (fs.existsSync(lockPath)) {
    const [pid, ts] = fs.readFileSync(lockPath, 'utf8').split(':').map(Number)
    let alive = false
    try { if (pid && pid !== process.pid) { process.kill(pid, 0); alive = true } } catch (e) {}
    // a lock not refreshed for 10 min is stale (power cut, PID reused)
    if (alive && ts && Date.now() - ts < 600000) {
      console.error(`[bot] another copy is already running (pid ${pid}). Exiting.`)
      process.exit(3)
    }
  }
  fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`)
}
const touchLock = () => { try { fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`) } catch (e) {} }
const dropLock = () => { try { fs.unlinkSync(lockPath) } catch (e) {} }

/** boxes bigger than MAX_BOX_DEG are cut up: WME returns nothing for huge areas */
const tile = (boxes, max) => {
  const out = []
  boxes.forEach(b => {
    const rows = Math.max(1, Math.ceil((b.n - b.s) / max - 1e-9))
    const cols = Math.max(1, Math.ceil((b.e - b.w) / max - 1e-9))
    const h = (b.n - b.s) / rows
    const w = (b.e - b.w) / cols
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({ s: b.s + r * h, n: b.s + (r + 1) * h, w: b.w + c * w, e: b.w + (c + 1) * w })
      }
    }
  })
  return out
}

const main = async () => {
  if (process.env.SENT_TO_TELEGRAM === 'true' && (!process.env.TELEGRAM_TOKEN || !process.env.CHAT_ID)) {
    throw new Error('SENT_TO_TELEGRAM=true but TELEGRAM_TOKEN or CHAT_ID is missing.')
  }
  takeLock()

  const fence = geofence.load(path.join(root, process.env.BOX_FILE || 'box.json'))
  if (!fence) throw new Error('box.json is missing - it defines the area to check.')
  const boxes = tile(fence.boxes, num('MAX_BOX_DEG', 1))

  const client = waze.create({ root })
  if (!client.hasCookie()) {
    throw new Error('No bot-account cookie. Paste it into cookie.txt (see README).')
  }

  const memory = makeMemory(path.join(dataDir, 'memory.json'))
  let seeding = memory.size() === 0 && !memory.get('seededAt') && process.env.SEED_ON_FIRST_RUN !== 'false'

  const adminChat = process.env.ADMIN_CHAT_ID || null
  const notifyAdmin = async text => {
    console.warn('[admin] ' + text)
    if (!adminChat || process.env.SENT_TO_TELEGRAM !== 'true') return
    try { await telegram(buildMessage.esc('[closure bot] ' + text), 0, adminChat) } catch (e) {
      console.error(`[admin] notice failed: ${e.message}`)
    }
  }

  console.log(`[bot] ${boxes.length} areas | countries=${allowedCountries().join(',')} | ` +
    `editors skipped=${[...editors()].join(',')} | cookie from ${client.source()} | memory=${memory.size()}`)
  if (seeding) console.log('[bot] FIRST RUN: the first lap is recorded, not posted')

  const startedAt = Date.now()
  let stopping = false

  /* ---- watchdog + heartbeat ------------------------------------------------- */
  let watchdogFired = false
  let lastBeat = Date.now()
  setInterval(() => {
    touchLock()
    const last = memory.get('lastSuccessAt') || startedAt
    if (Date.now() - last > num('WATCHDOG_MINUTES', 45) * 60000 && !watchdogFired) {
      watchdogFired = true
      notifyAdmin(`no successful Waze read for ${Math.round((Date.now() - last) / 60000)} min`)
    }
    const beat = num('HEARTBEAT_HOURS', 0) * 3600000
    if (beat && Date.now() - lastBeat >= beat) {
      lastBeat = Date.now()
      notifyAdmin(`heartbeat: running, ${memory.get('sentTotal') || 0} posted in total`)
    }
  }, 60000).unref()

  await notifyAdmin('started')

  /* ---- Telegram control from the admin group ------------------------------ */
  const live = { lap: 0, lastLap: '-', sessionDown: false, phase: 'starting', done: 0, total: 0, lapStart: 0, lastLapMs: memory.get('lastLapMs') || 0, nextAt: 0 }
  const progress = () => {
    const min = ms => Math.max(1, Math.round(ms / 60000))
    if (live.phase === 'pause') return `scan: finished, next scan starts in about ${min(live.nextAt - Date.now())} min`
    if (live.phase !== 'scanning' || !live.total) return 'scan: starting'
    const el = Date.now() - live.lapStart
    const pct = Math.round(live.done / live.total * 100)
    let left = null
    if (live.lastLapMs && live.lastLapMs > el) left = live.lastLapMs - el
    else if (live.done >= 5) left = el / live.done * (live.total - live.done)
    return `scan: area ${live.done}/${live.total} (${pct}%)` + (left == null ? ', estimating time left' : `, about ${min(left)} min left`)
  }
  const ago = t => t ? `${Math.round((Date.now() - t) / 60000)} min ago` : 'never'
  commands.start({
    memory,
    getStatus: () => [
      'WazeMY closure bot',
      `running for ${Math.round((Date.now() - startedAt) / 60000)} min, lap ${live.lap}${seeding ? ' (first lap: recording only)' : ''}`,
      `last successful read: ${ago(memory.get('lastSuccessAt'))}`,
      `bot account session: ${live.sessionDown ? 'NOT ACCEPTED - paste a new cookie.txt' : 'ok'}`,
      `posted in total: ${memory.get('sentTotal') || 0}, closures remembered: ${memory.size()}`,
      `last lap: ${live.lastLap}`,
      progress()
    ].join('\n'),
    onRestart: () => { memory.save(); dropLock(); process.exit(10) },
    onStop: () => {
      try { fs.writeFileSync(path.join(dataDir, 'STOP'), new Date().toISOString()) } catch (e) {}
      memory.save(); dropLock(); process.exit(0)
    }
  })

  const shutdown = () => {
    if (stopping) return
    stopping = true
    console.log('\n[bot] shutting down')
    memory.save()
    dropLock()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  let sessionDown = false
  let lap = 0

  while (!stopping) {
    lap++
    live.lap = lap
    const lapStart = Date.now()
    const found = new Map()
    const stats = { ok: 0, errors: 0, skipped: 0 }
    let sessionLost = null
    let rateHits = 0

    /* ---- 1. read closures area by area ------------------------------------- */
    live.phase = 'scanning'
    live.lapStart = lapStart
    live.total = boxes.length
    live.done = 0
    for (const [bi, box] of boxes.entries()) {
      if (stopping) break
      live.done = bi
      let done = false
      for (let attempt = 0; attempt <= num('REQUEST_RETRIES', 2) && !done; attempt++) {
        try {
          fromFeatures(await client.closuresIn(box)).forEach(c => found.set(String(c.id), c))
          stats.ok++
          done = true
        } catch (err) {
          if (err instanceof waze.SessionError) { sessionLost = err; break }
          if (err instanceof waze.RateLimitError) {
            rateHits++
            const wait = Math.min(600000, 60000 * rateHits)
            console.warn(`[bot] ${err.message} - waiting ${wait / 1000}s`)
            await sleep(wait)
            continue
          }
          stats.errors++
          if (attempt === num('REQUEST_RETRIES', 2)) {
            stats.skipped++
            console.error(`[bot] area skipped this lap: ${err.message}`)
          } else {
            await sleep(5000 * (attempt + 1))
          }
        }
      }
      if (sessionLost) break
      await sleep(num('REQUEST_PAUSE_MS', 1500))
    }

    /* ---- failsafe: session problems never kill the bot ---------------------- */
    if (sessionLost) {
      if (!sessionDown) {
        sessionDown = true
        live.sessionDown = true
        await notifyAdmin(`${sessionLost.message}. Retrying every ${num('SESSION_RETRY_MINUTES', 10)} min.`)
      }
      memory.save()
      await sleep(num('SESSION_RETRY_MINUTES', 10) * 60000)
      client.reload() // picks up a new cookie.txt without a restart
      continue
    }
    if (sessionDown && stats.ok > 0) {
      sessionDown = false
      live.sessionDown = false
      await notifyAdmin('bot account session works again')
    }

    /* ---- 2. classify -------------------------------------------------------- */
    const now = Date.now()
    const last = memory.get('lastSuccessAt')
    const maxAgeMs = Math.min(
      Math.max(num('FRESH_HOURS', 6) * 3600000, last ? now - last + 600000 : 0),
      num('CATCHUP_HOURS', 24) * 3600000)

    const tally = {}
    const count = k => { tally[k] = (tally[k] || 0) + 1 }
    const candidates = []
    for (const c of found.values()) {
      if (memory.has(c.id)) { count('already handled'); continue }
      const why = reason(c, { now, maxAgeMs })
      if (why) { count(why); continue }
      candidates.push(c)
    }

    if (seeding) {
      candidates.forEach(c => memory.remember(c.id, { x: 'seeded' }))
      console.log(`[bot] first lap: recorded ${candidates.length} existing closure(s) without posting`)
      seeding = false
      memory.set('seededAt', Date.now())
    } else {
      /* ---- 3. details + country check + post, one closure ID at a time ------ */
      for (const c of candidates) {
        if (stopping) break
        const point = pointOf(c)
        if (!point) { count('no geometry'); continue }
        let place
        try {
          place = resolvePlace(c, await client.detailsAt(point.lon, point.lat))
          await sleep(num('REQUEST_PAUSE_MS', 1500))
        } catch (err) {
          count('details failed (retry next lap)')
          console.error(`[bot] details for ${c.id} failed: ${err.message}`)
          continue
        }
        // failsafe: post ONLY when the country is known AND allowed
        if (!countryAllowed(place.country)) {
          const why = place.country ? `country ${place.country}` : 'country unknown'
          count(why)
          if (place.country) memory.remember(c.id, { x: why }) // known foreign: never re-check
          continue
        }
        try {
          const cc = String(place.country).toUpperCase() // per-country channel + bot: CHAT_ID_BX / TELEGRAM_TOKEN_BX
          if (cc !== String(process.env.HOME_COUNTRY || 'MY').toUpperCase() && !process.env['CHAT_ID_' + cc]) {
            count(`no channel set for ${cc}`) // failsafe: never post a foreign closure to the home channel
            continue
          }
          await telegram(buildMessage({ closure: c, place, point }), 0, process.env['CHAT_ID_' + cc] || null, process.env['TELEGRAM_TOKEN_' + cc] || null)
          memory.remember(c.id, { s: 1, st: place.street || '', by: c.creator })
          memory.set('sentTotal', (memory.get('sentTotal') || 0) + 1)
          memory.save()
          count('POSTED')
          console.log(`[bot] posted ${c.id} | ${place.country} | ${place.street || '?'} | by ${c.creator}`)
          await sleep(1500)
        } catch (err) {
          count('send failed (retry next lap)')
          console.error(`[bot] send failed, will retry next lap: ${err.message}`)
        }
      }
    }

    if (stats.ok > 0) {
      memory.set('lastSuccessAt', now)
      if (watchdogFired) { watchdogFired = false; notifyAdmin('Waze reads are working again') }
    }
    memory.set('lastLapAt', now)
    memory.save()

    live.lastLap = `${Math.round((Date.now() - lapStart) / 1000)}s, areas ok=${stats.ok} errors=${stats.errors}, ` +
      `closures=${found.size}, posted=${tally.POSTED || 0}`
    console.log(`[bot] ${new Date().toISOString()} lap ${lap} in ${Math.round((Date.now() - lapStart) / 1000)}s | ` +
      `areas ok=${stats.ok} errors=${stats.errors} skipped=${stats.skipped} | closures=${found.size} | ` +
      Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(', '))

    live.lastLapMs = Date.now() - lapStart
    if (live.total > 50) memory.set('lastLapMs', live.lastLapMs)
    live.phase = 'pause'
    live.nextAt = Date.now() + num('LAP_PAUSE_MS', 60000)
    await sleep(num('LAP_PAUSE_MS', 60000))
  }
}

process.on('unhandledRejection', err => console.error('[unhandledRejection]', (err && err.message) || err))
process.on('exit', dropLock)

// failsafe: a startup problem is retried, not fatal (except missing setup)
const start = async (attempt = 1) => {
  try {
    await main()
  } catch (err) {
    const setup = /config|box\.json|cookie|TELEGRAM/i.test(err.message)
    console.error(`[bot] ${setup ? 'setup problem' : 'startup failed'}: ${err.message}`)
    if (setup) { dropLock(); process.exit(1) }
    dropLock()
    const wait = Math.min(600000, 30000 * attempt)
    console.error(`[bot] retrying in ${wait / 1000}s`)
    setTimeout(() => start(attempt + 1), wait)
  }
}
start()

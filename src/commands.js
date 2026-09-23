'use strict'

/*
 * Telegram control from the admin group (ADMIN_CHAT_ID only).
 *   /status   uptime, last read, posts, memory, session state
 *   /restart  bot restarts itself (the run-bot wrapper starts it again)
 *   /stop     bot stops and stays stopped until start-bot.cmd is run
 *   /help
 * Messages from any other chat are ignored.
 * Uses getUpdates long polling; the last update id is kept in memory so a
 * restart never re-runs an old /restart.
 */

const https = require('https')

const call = (token, method, body, timeoutMs) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body || {})
  const req = https.request({
    hostname: process.env.TELEGRAM_API_HOST || 'api.telegram.org',
    path: `/bot${token}/${method}`,
    method: 'POST',
    timeout: timeoutMs,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, res => {
    let raw = ''
    res.on('data', c => { raw += c })
    res.on('end', () => {
      let j = {}
      try { j = JSON.parse(raw) } catch (e) {}
      resolve({ status: res.statusCode, body: j })
    })
  })
  req.on('error', reject)
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.write(data)
  req.end()
})

/* one listener per bot: the Malaysia bot and (if configured) the Brunei bot */
const makeReply = (bot, log) => text => call(bot.token, 'sendMessage', { chat_id: bot.admin, text }, 20000)
  .then(r => { if (!r.body || !r.body.ok) log(`[commands] ${bot.label} reply failed: ${(r.body && r.body.description) || r.status}`) })
  .catch(e => log(`[commands] ${bot.label} reply failed: ${e.message}`))

/*
 * Telegram only delivers a plain /status in a group to the bot that posted
 * there last, so whichever bot receives /status makes EVERY bot answer.
 */
const run = (bot, all, { memory, getStatus, onRestart, onStop, log, handled }) => {
  const { token, admin, key, label, reply } = bot
  let running = true

  const loop = async () => {
    let offset = Number(memory.get(key) || 0)
    let fails = 0
    log(`[commands] ${label} listening in chat ${admin}`)
    while (running) {
      try {
        const res = await call(token, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65000)
        if (res.status === 409) {
          log(`[commands] ${label}: another program is reading this bot's updates (409) - commands disabled for this bot`)
          return
        }
        if (res.status !== 200 || !res.body.ok) throw new Error(`HTTP ${res.status}`)
        fails = 0
        for (const u of res.body.result || []) {
          offset = u.update_id + 1
          memory.set(key, offset)
          memory.save()
          const m = u.message
          if (!m || !m.text) continue
          const inAdmin = String(m.chat && m.chat.id) === admin
          log(`[commands] ${label} got ${JSON.stringify(m.text)} from chat ${m.chat && m.chat.id}${inAdmin ? '' : ' (ignored: not the admin chat)'}`)
          if (!inAdmin) continue
          const k = m.chat.id + ':' + m.message_id
          if (handled.has(k)) continue // the same message reached both bots: answer it once
          handled.add(k)
          const cmd = m.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase()
          if (cmd === '/status') { for (const b of all) await b.reply(`[${b.label}]\n` + getStatus()) }
          else if (cmd === '/restart') { await reply(`[${label}] Restarting now...`); await onRestart() }
          else if (cmd === '/stop') { await reply(`[${label}] Stopping. Start again with start-bot.cmd on the PC.`); await onStop() }
          else if (cmd === '/help') await reply('/status - health\n/restart - restart the bot\n/stop - stop the bot')
        }
      } catch (err) {
        fails++
        await new Promise(r => setTimeout(r, Math.min(300000, 5000 * fails)))
      }
    }
  }
  loop()
  return { stop: () => { running = false } }
}

const start = opts => {
  opts = Object.assign({ log: console.log, handled: new Set() }, opts)
  if (process.env.TELEGRAM_COMMANDS === 'false') return { stop: () => {} }
  const bots = []
  const admin = String(process.env.ADMIN_CHAT_ID || '')
  const main = process.env.COMMAND_BOT_TOKEN || process.env.TELEGRAM_TOKEN
  if (main && admin) bots.push({ label: 'Malaysia bot', token: main, admin, key: 'tgOffset' })
  const bx = process.env.COMMAND_BOT_TOKEN_BX || process.env.TELEGRAM_TOKEN_BX
  const adminBx = String(process.env.ADMIN_CHAT_ID_BX || admin)
  if (bx && adminBx && bx !== main) bots.push({ label: 'Brunei bot', token: bx, admin: adminBx, key: 'tgOffset_BX' })
  bots.forEach(b => { b.reply = makeReply(b, opts.log) })
  const runners = bots.map(b => run(b, bots, opts))
  return { stop: () => runners.forEach(r => r.stop()) }
}

module.exports = { start }

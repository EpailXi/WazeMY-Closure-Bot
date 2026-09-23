'use strict'

const https = require('https')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const post = (token, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    timeout: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, res => {
    let raw = ''
    res.on('data', c => { raw += c })
    res.on('end', () => resolve({ status: res.statusCode, body: raw }))
  })
  req.on('error', reject)
  req.on('timeout', () => { req.destroy(new Error('timeout')) })
  req.write(data)
  req.end()
})

/**
 * Send one message. Errors are thrown, never swallowed -- the caller decides.
 */
const send = async (text, depth = 0, chatOverride = null, tokenOverride = null) => {
  const token = tokenOverride || process.env.TELEGRAM_TOKEN
  const chatId = chatOverride || process.env.CHAT_ID

  if (process.env.SENT_TO_TELEGRAM !== 'true') {
    console.log('[telegram] dry run (SENT_TO_TELEGRAM is not true):\n' + text + '\n')
    return
  }

  if (!token || !chatId) {
    throw new Error('TELEGRAM_TOKEN and CHAT_ID must be set when SENT_TO_TELEGRAM=true')
  }

  const base = { chat_id: chatId, disable_web_page_preview: true }
  // Forum/topic groups: message_thread_id targets one topic.
  if (process.env.MESSAGE_THREAD_ID && !chatOverride) {
    base.message_thread_id = Number(process.env.MESSAGE_THREAD_ID)
  }

  const res = await post(token, Object.assign({}, base, {
    text,
    parse_mode: 'MarkdownV2'
  }))

  if (res.status >= 200 && res.status < 300) return

  let parsed = {}
  try { parsed = JSON.parse(res.body) } catch (e) {}
  const desc = parsed.description || res.body

  if (res.status === 429 && depth < 3) {
    const wait = (((parsed.parameters || {}).retry_after) || 5) * 1000
    console.warn(`[telegram] rate limited, waiting ${wait}ms`)
    await sleep(wait)
    return send(text, depth + 1, chatOverride, tokenOverride)
  }

  // Markdown rejected -> resend as plain text rather than lose the closure
  if (res.status === 400 && depth < 1) {
    console.warn(`[telegram] markdown rejected (${desc}) - resending as plain text`)
    const plain = await post(token, Object.assign({}, base, {
      text: text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1')
    }))
    if (plain.status >= 200 && plain.status < 300) return
    throw new Error(`[telegram] plain-text retry failed (${plain.status}): ${plain.body}`)
  }

  throw new Error(`[telegram] send failed (${res.status}): ${desc}`)
}

module.exports = send

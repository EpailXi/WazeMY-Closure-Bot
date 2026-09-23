'use strict'

const fs = require('fs')
const path = require('path')

/*
 * Plain HTTP client for the Waze Map Editor data endpoint. NO browser.
 *
 *   GET https://www.waze.com/row-Descartes/app/Features?bbox=W,S,E,N&roadClosures=true
 *
 * Needs the session cookie of the BOT's own Waze account (never your
 * personal one). Put it in cookie.txt. Read-only: the bot never edits.
 *
 * The session is kept fresh: any cookie Waze sends back is saved to
 * data/cookies.json and used from then on.
 */

class SessionError extends Error {}
class RateLimitError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const parseCookieString = s => {
  const jar = {}
  String(s || '').replace(/^cookie:\s*/i, '').split(';').forEach(part => {
    const i = part.indexOf('=')
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  })
  return jar
}

const create = (opts = {}) => {
  const root = opts.root || path.join(__dirname, '..')
  const cookieFile = path.join(root, process.env.WAZE_COOKIE_FILE || 'cookie.txt')
  const savedFile = path.join(root, 'data', 'cookies.json')
  const base = (process.env.WME_BASE || 'https://www.waze.com').replace(/\/$/, '')
  const env = process.env.WAZE_ENV || 'row'
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 30000)
  const UA = process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

  let jar = {}
  let loadedFrom = null

  // cookie.txt wins when it is newer than the saved copy (you pasted a new one)
  const loadJar = () => {
    const txtTime = fs.existsSync(cookieFile) ? fs.statSync(cookieFile).mtimeMs : 0
    const savedTime = fs.existsSync(savedFile) ? fs.statSync(savedFile).mtimeMs : 0
    if (savedTime > txtTime) {
      try { jar = JSON.parse(fs.readFileSync(savedFile, 'utf8')); loadedFrom = 'data/cookies.json'; return } catch (e) {}
    }
    const raw = process.env.WAZE_COOKIE || (txtTime ? fs.readFileSync(cookieFile, 'utf8') : '')
    jar = parseCookieString(raw.trim())
    loadedFrom = process.env.WAZE_COOKIE ? 'WAZE_COOKIE' : path.basename(cookieFile)
  }

  const saveJar = () => {
    try {
      fs.mkdirSync(path.dirname(savedFile), { recursive: true })
      fs.writeFileSync(savedFile + '.tmp', JSON.stringify(jar))
      fs.renameSync(savedFile + '.tmp', savedFile)
    } catch (e) { console.error(`[waze] cannot save cookies: ${e.message}`) }
  }

  const absorb = res => {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    let changed = false
    list.forEach(c => {
      const [kv, ...attrs] = c.split(';')
      const i = kv.indexOf('=')
      if (i <= 0) return
      const k = kv.slice(0, i).trim()
      const v = kv.slice(i + 1).trim()
      const expired = attrs.some(a => /max-age=0|expires=thu, 01 jan 1970/i.test(a))
      if (expired || v === '') { if (k in jar) { delete jar[k]; changed = true } } else if (jar[k] !== v) { jar[k] = v; changed = true }
    })
    if (changed) saveJar()
  }

  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

  const get = async url => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: `${base}/editor`,
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: cookieHeader()
        }
      })
      absorb(res)
      const text = await res.text()
      if (res.status === 429) throw new RateLimitError('Waze rate limit (429)')
      if (res.status === 401 || res.status === 403 || /not logged in/i.test(text.slice(0, 300))) {
        throw new SessionError(`bot account session not accepted (HTTP ${res.status}) - put a fresh cookie in cookie.txt`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      try { return JSON.parse(text) } catch (e) { throw new Error('response was not JSON') }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`timed out after ${timeoutMs}ms`)
      throw err
    } finally { clearTimeout(t) }
  }

  const features = (box, extra = '') => get(
    `${base}/${env}-Descartes/app/Features?bbox=${box.w},${box.s},${box.e},${box.n}` +
    `&language=en&roadClosures=true${extra}`)

  /** closures in a box (no segment data - small responses) */
  const closuresIn = box => features(box)

  /** everything around one closure: segment, street, city, country */
  const detailsAt = (lon, lat) => {
    const d = Number(process.env.DETAIL_BOX_DEG || 0.002)
    return features({ w: lon - d, s: lat - d, e: lon + d, n: lat + d },
      '&roadTypes=1,2,3,4,5,6,7,8,10,15,16,17,18,19,20,22')
  }

  /** who is this session? used by npm run check */
  const session = () => get(`${base}/${env}-Descartes/app/Session?language=en`)

  loadJar()
  return {
    closuresIn, detailsAt, session, reload: loadJar,
    hasCookie: () => Object.keys(jar).length > 0,
    source: () => loadedFrom
  }
}

module.exports = { create, SessionError, RateLimitError, parseCookieString, sleep }

'use strict'

/*
 * End-to-end: runs the REAL bot (src/index.js, plain HTTP, no browser) against
 * a local fake Waze Map Editor server, in a temp copy of the project.
 *   run 1: posts the app-user closure once; skips editors, feed, Brunei,
 *          unknown country; rotates the session cookie
 *   run 2: restart -> same closure ID is not posted again
 *   run 3: session rejected -> bot alerts and waits, does not die; after a
 *          new cookie.txt is dropped in, it recovers and posts a new closure
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const NOW = Date.now()
const users = [
  { id: 1, userName: 'world_bxtmjkef', rank: 0 }, { id: 2, userName: 'editor_one', rank: 3 },
  { id: 3, userName: 'editor_two', rank: 2 }, { id: 4, userName: 'WazeClosures', rank: 5 }
]
const C = (id, segID, by, x, y, extra) => Object.assign({
  id, segID, forward: true, createdBy: by, createdOn: NOW - 10 * 60000, startDate: null, endDate: null,
  reason: '', attributions: null, provider: null, eventId: null,
  geometry: { type: 'LineString', coordinates: [[x, y], [x + 0.0002, y + 0.0002]] }
}, extra)
const closures = [
  C('1.1.app-kl', 10, 1, 101.70, 3.15, { reason: 'Fallen tree' }),
  C('1.1.editor_one', 11, 2, 101.71, 3.16),
  C('1.1.james', 12, 3, 101.72, 3.17),
  C('1.1.feed', 13, 4, 101.73, 3.18),
  C('1.1.app-brunei', 14, 1, 114.90, 4.90),
  C('1.1.app-nowhere', 99, 1, 101.60, 3.05) // its segment is never returned -> country unknown
]
const segs = {
  10: [101.70, 3.15, 'Jalan App', 'MY'], 11: [101.71, 3.16, 'Jalan E', 'MY'], 12: [101.72, 3.17, 'Jalan J', 'MY'],
  13: [101.73, 3.18, 'Jalan F', 'MY'], 14: [114.90, 4.90, 'Jalan Brunei', 'BX'], 15: [101.65, 3.20, 'Jalan Baru', 'MY']
}

let validCookie = 'good1'
let sawRotated = false
let requests = 0
const inBox = (x, y, q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const ck = (req.headers.cookie || '').match(/_web_session=([^;]+)/)
  const sess = ck && ck[1]
  if (sess === 'rotated-' + validCookie) sawRotated = true
  const ok = sess === validCookie || sess === 'rotated-' + validCookie
  if (!ok) { res.writeHead(403); return res.end('{"errorLevel":"ERROR","errorList":[{"code":100,"details":"user is not logged in."}]}') }
  requests++
  const headers = { 'content-type': 'application/json', 'set-cookie': `_web_session=rotated-${validCookie}; Path=/; HttpOnly` }
  if (u.pathname.endsWith('/app/Session')) { res.writeHead(200, headers); return res.end(JSON.stringify({ userName: 'closure_bot', rank: 0 })) }
  const q = u.searchParams.get('bbox').split(',').map(Number)
  const detail = u.searchParams.has('roadTypes')
  const rc = closures.filter(c => inBox(c.geometry.coordinates[0][0], c.geometry.coordinates[0][1], q))
  const body = { users: { objects: users }, roadClosures: { objects: rc } }
  if (detail) {
    const s = Object.entries(segs).filter(([, v]) => inBox(v[0], v[1], q))
    body.segments = { objects: s.map(([id]) => ({ id: +id, roadType: 2, primaryStreetID: +id * 10 })) }
    body.streets = { objects: s.map(([id, v]) => ({ id: +id * 10, name: v[2], cityID: v[3] === 'MY' ? 1 : 2 })) }
    body.cities = { objects: [{ id: 1, name: 'Test City', countryID: 135 }, { id: 2, name: 'Bandar Seri Begawan', countryID: 40 }] }
    body.countries = { objects: [{ id: 135, name: 'Malaysia', abbr: 'MY' }, { id: 40, name: 'Brunei', abbr: 'BX' }] }
  }
  res.writeHead(200, headers)
  res.end(JSON.stringify(body))
})

let failures = 0
const check = (name, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name); if (!cond) failures++ }

const src = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-bot-'))
fs.cpSync(path.join(src, 'src'), path.join(tmp, 'src'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'box.json'), JSON.stringify([
  { lat_n: '3.25', lat_s: '3.00', lon_n: '101.50', lon_s: '101.75' },
  { lat_n: '5', lon_n: '114', lat_s: '4', lon_s: '115' }
]))
fs.writeFileSync(path.join(tmp, 'config.txt'), 'SENT_TO_TELEGRAM=false\n')
fs.writeFileSync(path.join(tmp, 'cookie.txt'), 'Cookie: _web_session=good1; _csrf_token=t')

const run = (port, ms) => new Promise(resolve => {
  const env = Object.assign({}, process.env, {
    WME_BASE: `http://127.0.0.1:${port}`, REQUEST_PAUSE_MS: '10', LAP_PAUSE_MS: '500',
    SEED_ON_FIRST_RUN: 'false', SESSION_RETRY_MINUTES: '0.05', EDITORS: 'editor_one,editor_two'
  })
  const p = spawn(process.execPath, [path.join(tmp, 'src', 'index.js')], { env, cwd: tmp })
  let out = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { out += d })
  setTimeout(() => p.kill('SIGTERM'), ms)
  p.on('exit', () => resolve(out))
})
const posts = o => (o.match(/\[bot\] posted /g) || []).length

server.listen(0, async () => {
  const port = server.address().port

  console.log('\nrun 1')
  const o1 = await run(port, 5000)
  check('laps completed', /lap 2 in/.test(o1))
  check('app-user closure in Malaysia posted', o1.includes('posted 1.1.app-kl | MY | Jalan App | by world_bxtmjkef'))
  check('posted exactly once', posts(o1) === 1)
  check('dry-run message printed in GitLab layout', o1.includes('New app closure \\(A\\-B\\)') && o1.includes('Description : Fallen tree'))
  check('editor_one / editor_two skipped', /listed editor=2/.test(o1))
  check('WazeClosures skipped', /feed account=1/.test(o1))
  check('Brunei closure not posted', /country BX=1/.test(o1) && !o1.includes('posted 1.1.app-brunei'))
  check('unknown country not posted (failsafe)', /country unknown=1/.test(o1) && !o1.includes('posted 1.1.app-nowhere'))
  check('session cookie kept fresh (rotated value used)', sawRotated && fs.existsSync(path.join(tmp, 'data', 'cookies.json')))
  check('no browser used', !/chromium|playwright/i.test(fs.readFileSync(path.join(tmp, 'src', 'waze.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))

  console.log('\nrun 2: restart')
  const o2 = await run(port, 3000)
  check('same closure ID not posted again', posts(o2) === 0 && /already handled=/.test(o2))

  console.log('\nrun 3: session expires, then a new cookie is pasted')
  validCookie = 'good2'
  closures.push(C('1.1.app-new', 15, 1, 101.65, 3.20, { createdOn: Date.now() }))
  setTimeout(() => fs.writeFileSync(path.join(tmp, 'cookie.txt'), '_web_session=good2'), 4000)
  const o3 = await run(port, 12000)
  check('session problem reported, bot kept running', /session not accepted/.test(o3) && /lap \d+ in/.test(o3))
  check('recovered from new cookie.txt without restart', /session works again/.test(o3))
  check('new app closure posted after recovery', o3.includes('posted 1.1.app-new'))

  server.close()
  if (failures) console.log('\n--- run1 ---\n' + o1.slice(-2500) + '\n--- run3 ---\n' + o3.slice(-2500))
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exit(failures ? 1 : 0)
})

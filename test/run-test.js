'use strict'
/* Unit tests: rule, country, message, memory, cookies.  Run: npm test */

const os = require('os')
const path = require('path')
const fs = require('fs')

const { fromFeatures, reason, resolvePlace, countryAllowed, pointOf, parseLocal } = require('../src/closures')
const buildMessage = require('../src/message')
const makeMemory = require('../src/memory')
const { parseCookieString } = require('../src/waze')

let failures = 0
const check = (name, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + name); if (!cond) failures++ }

const NOW = Date.UTC(2026, 8, 22, 6, 0)
const opts = { now: NOW, maxAgeMs: 6 * 3600000 }

// shapes as seen in the live Features response (2026-09-22)
const feat = {
  users: { objects: [
    { id: 1, userName: 'world_bxtmjkef', rank: 0 }, { id: 2, userName: 'editor_one', rank: 3 },
    { id: 3, userName: 'editor_two', rank: 2 }, { id: 4, userName: 'WazeClosures', rank: 5 },
    { id: 5, userName: 'editor_three', rank: 4 }, { id: 6, userName: 'editor_four', rank: 3 }, { id: 7, userName: 'Radxz', rank: 0 }
  ] },
  roadClosures: { objects: [
    { id: '1.1.app', segID: 10, forward: true, createdBy: 1, createdOn: NOW - 600000, startDate: '2026-09-22 13:50', endDate: '2026-09-22 20:00', reason: 'Fallen tree', attributions: null, provider: null, eventId: null, geometry: { type: 'LineString', coordinates: [[101.70, 3.15], [101.71, 3.16]] } },
    { id: '1.1.epx', segID: 11, createdBy: 2, createdOn: NOW - 600000 },
    { id: '1.1.jam', segID: 12, createdBy: 3, createdOn: NOW - 600000 },
    { id: '1.1.feed', segID: 13, createdBy: 4, createdOn: NOW - 600000 },
    { id: '1.1.zen', segID: 14, createdBy: 5, createdOn: NOW - 600000 },
    { id: '1.1.dino', segID: 15, createdBy: 6, createdOn: NOW - 600000 },
    { id: '1.1.nouser', segID: 16, createdBy: 999, createdOn: NOW - 600000 }
  ] }
}
const cl = fromFeatures(feat)
const byId = id => cl.find(c => c.id === id)

process.env.EDITORS = 'editor_one,editor_two,editor_three,editor_four' // the EDITORS setting under test
console.log('\ncreator rule')
check('creator name attached', byId('1.1.app').creator === 'world_bxtmjkef')
check('app user -> posted', reason(byId('1.1.app'), opts) === null)
check('editor_one skipped (any case)', reason(byId('1.1.epx'), opts) === 'listed editor')
check('editor_two skipped', reason(byId('1.1.jam'), opts) === 'listed editor')
check('editor_three skipped', reason(byId('1.1.zen'), opts) === 'listed editor')
check('editor_four skipped', reason(byId('1.1.dino'), opts) === 'listed editor')
check('WazeClosures skipped', reason(byId('1.1.feed'), opts) === 'feed account')
check('unknown creator not posted', reason(byId('1.1.nouser'), opts) === 'creator unknown')
process.env.EDITORS = 'someoneelse'
check('EDITORS setting is honoured', reason(byId('1.1.epx'), opts) === null)
process.env.EDITORS = ''
check('empty EDITORS skips nobody', reason(byId('1.1.epx'), opts) === null)
delete process.env.EDITORS

console.log('\nother skips')
const app = byId('1.1.app')
const v = extra => reason(Object.assign({}, app, extra), opts)
check('partner provider skipped', v({ provider: 'IRDA' }) === 'partner/feed')
check('external provider skipped', v({ externalProviderId: 'x1' }) === 'partner/feed')
check('WME channel skipped', v({ attributions: [{ channel: 'WME_COMMUNITY_EDITOR' }] }) === 'made in WME')
check('FEED channel skipped', v({ attributions: [{ channel: 'FEED' }] }) === 'made in WME')
check('MTE closure skipped', v({ eventId: 'ev1' }) === 'major traffic event')
check('old closure skipped', v({ createdOn: NOW - 30 * 3600000 }) === 'old')
check('scheduled tomorrow skipped', v({ startDate: '2026-09-23 08:00' }) === 'scheduled for later')
check('ended skipped', v({ endDate: '2026-09-22 10:00' }) === 'ended')
check('local time parsed as MYT', parseLocal('2026-09-22 14:00') === NOW)

console.log('\ncountry (failsafe)')
const det = {
  segments: { objects: [{ id: 10, roadType: 2, primaryStreetID: 100 }] },
  streets: { objects: [{ id: 100, name: 'Jalan Test_Road', cityID: 1000 }] },
  cities: { objects: [{ id: 1000, name: 'Test City', countryID: 135 }] },
  countries: { objects: [{ id: 135, name: 'Malaysia', abbr: 'MY' }] }
}
const place = resolvePlace(app, det)
check('street/city/country resolved', place.street === 'Jalan Test_Road' && place.city === 'Test City' && place.country === 'MY')
check('MY allowed by default', countryAllowed('MY'))
check('Brunei (BX) blocked by default', !countryAllowed('BX'))
check('unknown country blocked', !countryAllowed(null))
process.env.ALLOWED_COUNTRIES = 'MY, bx'
check('ALLOWED_COUNTRIES setting honoured', countryAllowed('BX') && countryAllowed('my'))
delete process.env.ALLOWED_COUNTRIES
check('segment missing -> country unknown', resolvePlace(Object.assign({}, app, { segID: 1 }), det).country === null)
check('midpoint of geometry', pointOf(app).lat === 3.16)

console.log('\nmessage (GitLab layout)')
const msg = buildMessage({ closure: app, place, point: pointOf(app) })
check('header + direction', msg.startsWith('*⛔️ New app closure \\(A\\-B\\)*'))
check('road type line', msg.includes('Primary Street segment'))
check('street escaped', msg.includes('Jalan Test\\_Road, Test City'))
check('description = closure reason', msg.includes('Description : Fallen tree'))
check('reported by creator', msg.includes('Reported by : world\\_bxtmjkef'))
check('WME link has segment', msg.includes('segments=10'))
check('App link', msg.includes('[App](https://waze.com/ul?ll=3.16,101.71)'))
check('bare closure does not crash', buildMessage({ closure: { id: 'x' } }).includes('NO CITY'))

console.log('\nmemory')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'))
const f = path.join(dir, 'memory.json')
const m = makeMemory(f)
m.remember('1.1.app', { s: 1 }); m.set('lastSuccessAt', 123); m.save()
check('same ID remembered across restart', makeMemory(f).has('1.1.app') && makeMemory(f).get('lastSuccessAt') === 123)
fs.writeFileSync(f, '{broken')
check('corrupt file -> restored from backup', makeMemory(f).has('1.1.app'))

console.log('\ncookie parsing')
const jar = parseCookieString('Cookie: _web_session=abc==; _csrf_token=x-y; empty')
check('pasted "Cookie:" header accepted', jar._web_session === 'abc==' && jar._csrf_token === 'x-y' && !('empty' in jar))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures ? 1 : 0)

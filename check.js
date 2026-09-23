'use strict'

/*
 * npm run check  - about 30 seconds, posts nothing.
 *  1. is the bot-account cookie accepted?  (prints the account name)
 *  2. reads closures in CHECK_BOX and prints each creator + verdict
 *  3. looks up the country for the first few app closures
 */

const loaded = require('./src/config').load()
if (!loaded) console.log('[config] no config.txt - using defaults')

const waze = require('./src/waze')
const { fromFeatures, reason, resolvePlace, countryAllowed, pointOf, editors } = require('./src/closures')

const [n, s, w, e] = String(process.env.CHECK_BOX || '3.25,3.00,101.55,101.80').split(',').map(Number)

;(async () => {
  const client = waze.create()
  if (!client.hasCookie()) { console.log('RESULT: NO COOKIE - paste the bot account cookie into cookie.txt'); process.exit(1) }

  let me
  try { me = await client.session() } catch (err) {
    console.log(`RESULT: SESSION REJECTED - ${err.message}`); process.exit(1)
  }
  console.log(`Logged in as: ${me.userName} (rank ${(me.rank || 0) + 1})`)
  if (editors().has(String(me.userName).toLowerCase())) {
    console.log('WARNING: this is an editor account from your list - use the separate bot account.')
  }

  const closures = fromFeatures(await client.closuresIn({ n, s, w, e }))
  const recentFirst = closures.sort((a, b) => (b.createdOn || 0) - (a.createdOn || 0))
  const byCreator = {}
  closures.forEach(c => { byCreator[c.creator || '?'] = (byCreator[c.creator || '?'] || 0) + 1 })
  console.log(`\nClosures in ${n},${s},${w},${e}: ${closures.length}`)
  console.log('By creator: ' + Object.entries(byCreator).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}=${v}`).join(', '))

  console.log('\nNewest 15 (verdict ignores the age limit here):')
  let looked = 0
  for (const c of recentFirst.slice(0, 15)) {
    const why = reason(c, { maxAgeMs: 3650 * 86400000 })
    let country = ''
    if (!why && looked < 5) {
      looked++
      const p = pointOf(c)
      try {
        const place = resolvePlace(c, await client.detailsAt(p.lon, p.lat))
        country = ` | ${place.street || '?'}, ${place.city || '?'} | country=${place.country || 'unknown'}${countryAllowed(place.country) ? '' : ' (NOT allowed)'}`
      } catch (err) { country = ` | details failed: ${err.message}` }
    }
    const when = c.createdOn ? new Date(c.createdOn + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '?'
    console.log(`${why ? 'skip: ' + why.padEnd(20) : 'APP  -> would post   '} | ${when} | by ${c.creator || '?'}${country}`)
  }
  console.log('\nRESULT: WORKS')
})().catch(err => { console.log('RESULT: FAILED - ' + err.message); process.exit(1) })

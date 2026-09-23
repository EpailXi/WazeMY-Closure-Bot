'use strict'

/*
 * Which closures count as "sent from the app", using Map Editor data.
 * Every closure there records its creator (createdBy -> users[].userName).
 *
 * A closure is posted only if ALL are true:
 *   1. its creator is known
 *   2. creator is NOT in EDITORS        (your own editor usernames)
 *   3. creator is NOT in FEED_ACCOUNTS  (WazeClosures)
 *   4. no provider / external provider  (partner feeds: IRDA, MBPP, LTA ...)
 *   5. no WME attribution channel       (Waze itself says it was made in WME)
 *   6. not part of a Major Traffic Event (editor-only feature)
 *   7. created within the freshness window, not scheduled for later, not ended
 * and after the details lookup:
 *   8. its segment's country is in ALLOWED_COUNTRIES (unknown = not posted)
 */

const list = (v, def) => String(v == null ? def : v)
  .split(',').map(s => s.trim()).filter(Boolean)

const editors = () => new Set(list(process.env.EDITORS, '').map(s => s.toLowerCase()))
const feedAccounts = () => new Set(list(process.env.FEED_ACCOUNTS, 'WazeClosures').map(s => s.toLowerCase()))
const allowedCountries = () => list(process.env.ALLOWED_COUNTRIES, 'MY').map(s => s.toUpperCase())

const WME_CHANNELS = /^(WME_|FEED$)/

/** "2026-09-22 21:50" (closure local time) -> ms */
const parseLocal = s => {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return null
  const off = Number(process.env.TZ_OFFSET_HOURS || 8)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - off, +m[5])
}

/** Features response -> closures with the creator's name attached */
const fromFeatures = data => {
  const users = new Map(((data && data.users && data.users.objects) || []).map(u => [u.id, u]))
  const rc = (data && data.roadClosures && data.roadClosures.objects) || []
  return rc.map(c => {
    const u = users.get(c.createdBy)
    return Object.assign({}, c, { creator: u ? u.userName : null, creatorRank: u ? u.rank : null })
  })
}

const reason = (c, opts = {}) => {
  if (!c || !c.id) return 'no id'
  if (!c.creator) return 'creator unknown'
  const who = String(c.creator).toLowerCase()
  if (editors().has(who)) return 'listed editor'
  if (feedAccounts().has(who)) return 'feed account'
  if (c.provider || c.externalProvider || c.externalProviderId) return 'partner/feed'
  const ch = (c.attributions || []).map(a => a && a.channel).filter(Boolean)
  if (process.env.SKIP_WME_CHANNEL !== 'false' && ch.some(x => WME_CHANNELS.test(x))) return 'made in WME'
  if (process.env.SKIP_EVENT_CLOSURES !== 'false' && c.eventId) return 'major traffic event'

  const now = opts.now || Date.now()
  const maxAgeMs = opts.maxAgeMs != null ? opts.maxAgeMs : Number(process.env.FRESH_HOURS || 6) * 3600000
  if (!c.createdOn) return 'no creation time'
  if (Number(c.createdOn) < now - maxAgeMs) return 'old'
  const start = parseLocal(c.startDate)
  if (start != null && start > now + 10 * 60000) return 'scheduled for later'
  const end = parseLocal(c.endDate)
  if (end != null && end < now) return 'ended'
  return null
}

/** Resolve segment -> street -> city -> country from a detailsAt() response */
const resolvePlace = (c, data) => {
  const find = (key, id) => ((data && data[key] && data[key].objects) || []).find(o => o.id === id) || null
  const seg = find('segments', c.segID)
  const street = seg ? find('streets', seg.primaryStreetID) : null
  const city = street ? find('cities', street.cityID) : null
  const country = city ? find('countries', city.countryID) : null
  return {
    found: !!seg,
    roadType: seg ? seg.roadType : null,
    street: street && street.name ? street.name : null,
    city: city && city.name ? city.name : null,
    country: country ? (country.abbr || null) : null,
    countryName: country ? country.name : null
  }
}

const countryAllowed = abbr => !!abbr && allowedCountries().includes(String(abbr).toUpperCase())

/** middle point of the closure's own geometry */
const pointOf = c => {
  const co = c && c.geometry && c.geometry.coordinates
  if (!Array.isArray(co) || !co.length) return null
  const p = co[Math.floor(co.length / 2)]
  return Array.isArray(p) ? { lon: Number(p[0]), lat: Number(p[1]) } : null
}

module.exports = { fromFeatures, reason, resolvePlace, countryAllowed, pointOf, parseLocal, editors, allowedCountries }

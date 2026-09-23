'use strict'

const fs = require('fs')

/*
 * box.json defines the area you manage.
 *
 * Note the field naming from the original project: lon_n is the WEST edge and
 * lon_s is the EAST edge (v1 called query(lat_n, lat_s, lon_n, lon_s) which
 * mapped to top, bottom, left, right). Kept as-is so your existing file works
 * unchanged.
 *
 * This is a far better filter than the old COUNTRY_CODE string compare: a
 * closure is reported only if its coordinates actually fall inside one of your
 * boxes.
 */
const load = boxPath => {
  if (!fs.existsSync(boxPath)) return null

  const raw = JSON.parse(fs.readFileSync(boxPath, 'utf8'))
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('box.json must be a non-empty array')
  }

  const boxes = raw.map((b, i) => {
    const n = Number(b.lat_n)
    const s = Number(b.lat_s)
    const w = Number(b.lon_n)
    const e = Number(b.lon_s)
    if ([n, s, w, e].some(v => isNaN(v))) {
      throw new Error(`box.json entry ${i} has a non-numeric edge`)
    }
    return {
      n: Math.max(n, s),
      s: Math.min(n, s),
      w: Math.min(w, e),
      e: Math.max(w, e)
    }
  })

  // bounding box of everything, for a cheap early reject
  const outer = boxes.reduce((acc, b) => ({
    n: Math.max(acc.n, b.n),
    s: Math.min(acc.s, b.s),
    w: Math.min(acc.w, b.w),
    e: Math.max(acc.e, b.e)
  }), { n: -90, s: 90, w: 180, e: -180 })

  const contains = (lat, lon) => {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return false
    if (lat < outer.s || lat > outer.n || lon < outer.w || lon > outer.e) return false
    for (const b of boxes) {
      if (lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e) return true
    }
    return false
  }

  return { boxes, outer, contains, size: boxes.length }
}

/** Where is this alert? Live Map gives location {x: lon, y: lat}. */
const closurePoint = a => {
  const loc = a && a.location
  if (!loc || loc.x == null || loc.y == null) return null
  const lat = Number(loc.y)
  const lon = Number(loc.x)
  return isNaN(lat) || isNaN(lon) ? null : { lat, lon }
}

/*
 * Rough outline of Singapore, following the middle of the Johor Strait.
 * The Johor boxes in box.json overlap Singapore and Live Map alerts carry no
 * country, so this drops SG closures. Accurate to a few hundred metres at the
 * causeway / second link - good enough for this.
 */
const SINGAPORE = [
  [1.150, 103.600], [1.350, 103.600], [1.400, 103.630], [1.435, 103.670],
  [1.447, 103.720], [1.451, 103.765], [1.452, 103.790], [1.445, 103.820],
  [1.430, 103.870], [1.420, 103.910], [1.410, 103.960], [1.400, 104.000],
  [1.380, 104.060], [1.300, 104.100], [1.150, 104.100]
]

const inPolygon = (lat, lon, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

const inSingapore = (lat, lon) => inPolygon(lat, lon, SINGAPORE)

module.exports = { load, closurePoint, inSingapore, inPolygon }

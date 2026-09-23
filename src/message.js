'use strict'

const ROAD_TYPES = {
  1: 'Street', 2: 'Primary Street', 3: 'Freeway', 4: 'Ramp', 5: 'Walking Trail',
  6: 'Major Highway', 7: 'Minor Highway', 8: 'Off-road', 10: 'Pedestrian Boardwalk',
  15: 'Ferry', 16: 'Stairway', 17: 'Private Road', 18: 'Railroad', 19: 'Runway',
  20: 'Parking Lot Road', 22: 'Narrow Street'
}

// MarkdownV2: escape ONLY untrusted values, never the whole message.
const esc = v => String(v == null ? '' : v).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
const trim = v => String(v == null ? '' : v).trim()

// Same layout as the original GitLab bot (model/message.js newClosure).
const build = ({ closure: c, place = {}, point = null }) => {
  const dir = c.forward === false ? '(B-A)' : '(A-B)'
  const rt = place.roadType != null ? (ROAD_TYPES[place.roadType] || `Unknown - ${place.roadType}`) : 'Unknown'
  const where = (trim(place.street) ? `${trim(place.street)}, ` : '') + (trim(place.city) || '--NO CITY--')

  const lines = [
    `*⛔️ New app closure ${esc(dir)}*`,
    '',
    `${esc(rt)} segment \\| From: ${esc(c.startDate || '-')} \\| Until: ${esc(c.endDate || '-')}`,
    esc(where),
    `Description : ${esc(trim(c.reason) || '-')}`,
    `Reported by : ${esc(c.creator || '-')}`
  ]

  if (point) {
    const env = process.env.WAZE_ENV || 'row'
    const app = process.env.APP_LINK_BASE || 'https://waze.com/ul'
    lines.push('', [
      `[Live Map](https://www.waze.com/livemap?zoom=17&lon=${point.lon}&lat=${point.lat}&overlay=false&cta=false)`,
      `[WME](https://www.waze.com/editor/?env=${env}&lon=${point.lon}&lat=${point.lat}&zoomLevel=18${c.segID ? `&segments=${c.segID}` : ''})`,
      `[App](${app}?ll=${point.lat},${point.lon})`
    ].join(' \\| '))
  }
  return lines.join('\n')
}

module.exports = build
module.exports.esc = esc

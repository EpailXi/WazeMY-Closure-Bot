'use strict'

const fs = require('fs')
const path = require('path')

/*
 * Loads settings from the first file that exists:
 *
 *   config.txt   <- plainly visible in Explorer and Finder. Use this one.
 *   config.env
 *   .env         <- classic, but hidden by default on Windows and macOS
 *
 * Files whose name starts with a dot are hidden by both Explorer and Finder,
 * and Windows Explorer will not even let you create one normally. config.txt
 * exists so you never have to fight that.
 */
const CANDIDATES = ['config.txt', 'config.env', '.env']

const parse = text => {
  const out = {}
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const eq = trimmed.indexOf('=')
    if (eq === -1) return

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()

    // tolerate quotes people paste in by habit
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key) out[key] = value
  })
  return out
}

const load = (root = path.join(__dirname, '..')) => {
  for (const name of CANDIDATES) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue

    const values = parse(fs.readFileSync(file, 'utf8'))
    Object.keys(values).forEach(k => {
      // real environment variables still win
      if (process.env[k] === undefined) process.env[k] = values[k]
    })
    return { file: name, count: Object.keys(values).length }
  }
  return null
}

module.exports = { load, parse, CANDIDATES }

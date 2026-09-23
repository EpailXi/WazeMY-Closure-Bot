'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parse, load } = require('../src/config')

let failures = 0
const check = (n, c) => { console.log((c ? '  PASS  ' : '  FAIL  ') + n); if (!c) failures++ }

console.log('\nsettings parsing')
const p = parse([
  '# a comment',
  '',
  'SENT_TO_TELEGRAM=true',
  'TELEGRAM_TOKEN=123:ABC-def_ghi',
  'CHAT_ID = "@mychannel"',      // spaces + quotes, as people paste them
  "MESSAGE_THREAD_ID='42'",
  'EMPTY=',
  'no_equals_here'
].join('\n'))

check('plain value', p.SENT_TO_TELEGRAM === 'true')
check('token with colon and dashes survives', p.TELEGRAM_TOKEN === '123:ABC-def_ghi')
check('spaces around = tolerated', p.CHAT_ID === '@mychannel')
check('double quotes stripped', !p.CHAT_ID.includes('"'))
check('single quotes stripped', p.MESSAGE_THREAD_ID === '42')
check('empty value kept', p.EMPTY === '')
check('comment ignored', !('# a comment' in p))
check('malformed line ignored', !('no_equals_here' in p))

console.log('\nfile discovery')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcb-'))
fs.writeFileSync(path.join(dir, 'config.txt'), 'FROM_FILE=config_txt\n')
delete process.env.FROM_FILE
let r = load(dir)
check('config.txt found', r && r.file === 'config.txt')
check('value applied to env', process.env.FROM_FILE === 'config_txt')

check('missing file returns null', load(fs.mkdtempSync(path.join(os.tmpdir(), 'wcb-'))) === null)

process.env.WINS = 'from_real_env'
fs.writeFileSync(path.join(dir, 'config.txt'), 'WINS=from_file\n')
load(dir)
check('real environment variable wins over the file', process.env.WINS === 'from_real_env')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures ? 1 : 0)

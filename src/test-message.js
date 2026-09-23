'use strict'
// npm run test-message : sends ONE test message to CHAT_ID
const loaded = require('./config').load()
if (!loaded) { console.log('No config.txt'); process.exit(1) }
process.env.SENT_TO_TELEGRAM = 'true'
const telegram = require('./telegram')
telegram('*🧪 TEST* \\- WazeMY closure bot is connected\\. This is a one\\-time test message, please ignore\\.')
  .then(() => { console.log('TEST MESSAGE SENT OK to ' + process.env.CHAT_ID); process.exit(0) })
  .catch(err => { console.log('TEST MESSAGE FAILED: ' + err.message); process.exit(1) })

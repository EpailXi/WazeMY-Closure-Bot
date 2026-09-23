# Waze App-Closure Bot

Posts to Telegram when a road closure **reported from the Waze app** appears in
your area. Closures made in the Waze Map Editor, by partner feeds or by listed
editors are filtered out.

Plain HTTP, no browser, no dependencies (Node 18+).

> **Before committing:** `config.txt` and `cookie.txt` hold your Telegram bot
> tokens and a Waze session. They are in `.gitignore` — never add them to the
> repo. Use a **separate Waze account** for the bot, never your own editor login.

## What a post looks like

```
⛔️ New app closure (A-B)

Primary Street segment | From: 2026-09-23 08:15 | Until: 2026-09-23 12:00
Jalan Hujan Abu, Kuala Lumpur
Description : Pokok tumbang
Reported by : world_06kfudou

Live Map | WME | App
```

## How it decides

It reads Map Editor closure data, which records who created each closure, using
the session of a separate bot Waze account. A closure is posted only if ALL are true:

1. the creator is not in `EDITORS` (your own editor usernames)
2. the creator is not a feed account (`WazeClosures`) and has no partner provider
3. Waze has not marked it as made in WME, and it is not a Major Traffic Event closure
4. it was created within `FRESH_HOURS` (6), does not start later, has not ended
5. its road is in `ALLOWED_COUNTRIES`; an unknown country is never posted
6. its closure ID has never been handled before (memory)

A typical nationwide round reads ~3,800 closures and posts the 1–3 that are new
and app-made.

## Two countries, two bots

Each country can have its own Telegram bot and channel. Country codes are Waze's
own (`MY` Malaysia, `BX` Brunei):

```
ALLOWED_COUNTRIES=MY,BX
HOME_COUNTRY=MY
TELEGRAM_TOKEN=      CHAT_ID=        # used for HOME_COUNTRY
TELEGRAM_TOKEN_BX=   CHAT_ID_BX=     # used for BX closures
```

If a country has no `CHAT_ID_<code>`, its closures are skipped rather than sent to
the wrong channel. Add more countries the same way: `TELEGRAM_TOKEN_XX` + `CHAT_ID_XX`.

## Setup

```bash
git clone <this repo> waze-closure-bot
cd waze-closure-bot
copy config.example.txt config.txt      # Linux/macOS: cp
copy box.example.json box.json          # then put your own areas in it
```

1. **Telegram** — create a bot with @BotFather, add it to your channel as an
   administrator, then fill in `TELEGRAM_TOKEN` and `CHAT_ID` in `config.txt`
   (optionally `ADMIN_CHAT_ID` for alerts and commands).
2. **Bot account cookie** — in a private browser window:
   - log in to <https://www.waze.com/editor> with the **bot** account
   - press F12 → Network → reload → click a request starting with `Features`
   - Headers → Request Headers → `cookie` → copy the whole value
   - paste it into a new file `cookie.txt` in this folder and save
   - close the window (do **not** press Log out, that ends the session)
3. `npm run check` → must show `Logged in as: <bot account>` and `RESULT: WORKS`
4. Set `SENT_TO_TELEGRAM=true`, then `npm start`

`box.json` is the list of areas to check, as `lat_n / lat_s / lon_n / lon_s`
boxes. `BOX_FILE=box-kl.json` switches to a small single-area file for testing.

## Run in the background (Windows)

- `install-autostart.cmd` (right-click → Run as administrator, once): starts at
  boot with no login and no window, re-checks every 5 min, restarts after crashes.
- `start-bot.cmd` / `stop-bot.cmd` / `restart-bot.cmd` / `status-bot.cmd`
  (stop stays stopped, even after a reboot, until `start-bot.cmd`).
- Log: `data\bot.log`, rolls over at 5 MB.
- In the admin group: `/status` (health + scan progress), `/restart`, `/stop`, `/help`.
  With two bots configured, both answer, each labelled.
- `npm run test-message` sends one test message to `CHAT_ID`.

## Memory & failsafes

- `data/memory.json` keeps every handled closure ID for 30 days, so nothing is
  posted twice, even after restarts. Atomic writes plus a backup copy.
- A closure is marked as posted only after Telegram accepts it; failed sends retry.
- The Waze session cookie is refreshed automatically when Waze rotates it. If it
  expires: alert to `ADMIN_CHAT_ID`, retry every 10 min, and a new `cookie.txt` is
  picked up without a restart.
- Retries and back-off on errors and rate limits; a failing area is skipped for
  that round, never fatal.
- Watchdog alert after 45 min without a successful read; optional heartbeat.
- Startup problems are retried; only one copy can run (`data/bot.lock`).

## Settings

All in `config.txt`; see `config.example.txt` for the full list with comments.
Common ones: `FRESH_HOURS`, `ALLOWED_COUNTRIES`, `EDITORS`, `FEED_ACCOUNTS`,
`BOX_FILE`, `REQUEST_PAUSE_MS`, `LAP_PAUSE_MS`, `MEMORY_DAYS`, `WATCHDOG_MINUTES`.

## Privacy & safety

- `config.txt`, `cookie.txt`, `box.json` and `data/` are git-ignored: tokens,
  session, your areas and history stay local.
- The bot only sends GET requests to Waze. It never edits, saves or closes anything.
- It reads the Map Editor's own data service, which is not a published API, so
  Waze can change it without notice. Errors are logged and the watchdog alerts you.

## Tests

`npm test` — unit tests plus an end-to-end run of the real bot against a fake Map
Editor and fake Telegram: posting, every skip rule, the country failsafe,
duplicate protection, cookie expiry and recovery.

## Licence

MIT, see `LICENSE`.

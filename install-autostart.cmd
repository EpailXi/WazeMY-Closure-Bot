@echo off
rem Run ONCE as Administrator: sets up auto start at boot + watchdog, then starts the bot.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
pause

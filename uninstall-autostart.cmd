@echo off
cd /d "%~dp0"
call "%~dp0stop-bot.cmd" >nul
schtasks /Delete /TN WazeClosureBot /F && echo Autostart removed.

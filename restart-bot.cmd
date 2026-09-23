@echo off
cd /d "%~dp0"
call "%~dp0stop-bot.cmd" >nul
timeout /t 3 /nobreak >nul
call "%~dp0start-bot.cmd"

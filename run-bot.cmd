@echo off
rem Watchdog wrapper: keeps the bot running, restarts it 30s after any crash.
rem Started by the "WazeClosureBot" scheduled task (see install-autostart.cmd).
cd /d "%~dp0"
if not exist data mkdir data
set NODE_EXE=node
if exist data\node-path.txt set /p NODE_EXE=<data\node-path.txt
:loop
if exist data\STOP (
  echo [%date% %time%] STOP flag present - not starting. Run start-bot.cmd to start.>>data\bot.log
  exit /b 0
)
powershell -NoProfile -Command "if ((Test-Path 'data\bot.log') -and ((Get-Item 'data\bot.log').Length -gt 5MB)) { Move-Item -Force 'data\bot.log' 'data\bot.old.log' }"
echo [%date% %time%] ---- starting bot ---->>data\bot.log
"%NODE_EXE%" src\index.js >>data\bot.log 2>&1
set RC=%errorlevel%
echo [%date% %time%] bot exited with code %RC%>>data\bot.log
if exist data\STOP exit /b 0
if "%RC%"=="10" goto loop
timeout /t 30 /nobreak >nul
goto loop

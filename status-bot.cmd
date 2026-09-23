@echo off
cd /d "%~dp0"
schtasks /Query /TN WazeClosureBot /FO LIST | findstr /R "Status: Last"
if exist data\STOP echo STOP flag is set - bot is deliberately stopped.
echo ---- last log lines ----
powershell -NoProfile -Command "if (Test-Path 'data\bot.log') { Get-Content 'data\bot.log' -Tail 15 } else { 'no log yet' }"
pause

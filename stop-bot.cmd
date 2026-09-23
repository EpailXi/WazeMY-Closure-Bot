@echo off
rem Stops the bot and keeps it stopped (also across the 5-minute re-check and reboots)
cd /d "%~dp0"
if not exist data mkdir data
echo %date% %time%>data\STOP
schtasks /End /TN WazeClosureBot >nul 2>&1
if exist data\bot.lock for /f "tokens=1 delims=:" %%p in (data\bot.lock) do taskkill /PID %%p /T /F >nul 2>&1
echo Bot stopped. Run start-bot.cmd to start it again.

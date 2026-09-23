@echo off
cd /d "%~dp0"
if exist data\STOP del data\STOP
schtasks /Run /TN WazeClosureBot >nul && echo Bot started (log: data\bot.log)

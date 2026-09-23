# Creates the "WazeClosureBot" scheduled task (run via install-autostart.cmd as Administrator)
#  - starts at boot, no login needed, no window (runs as SYSTEM)
#  - re-checked every 5 minutes: if the bot is not running it is started again
#  - no time limit, only one copy at a time, restarted by Windows if the task fails
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force (Join-Path $dir 'data') | Out-Null
[IO.File]::WriteAllText((Join-Path $dir 'data\node-path.txt'), $node)

$act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + (Join-Path $dir 'run-bot.cmd') + '"') -WorkingDirectory $dir
$t1 = New-ScheduledTaskTrigger -AtStartup
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$pr = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'WazeClosureBot' -Action $act -Trigger $t1, $t2 -Settings $set -Principal $pr -Force | Out-Null

$stop = Join-Path $dir 'data\STOP'
if (Test-Path $stop) { Remove-Item $stop }
Start-ScheduledTask -TaskName 'WazeClosureBot'
Write-Host "Installed and started. Node: $node"
Write-Host "Log: $(Join-Path $dir 'data\bot.log')"

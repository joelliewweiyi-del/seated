# Start Seated in the background every time you log in to Windows, and keep it running.
#   powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1            # turn on
#   powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1 -Remove    # turn off
# The log goes to data\seated.log. The dashboard is at http://127.0.0.1:4310.
# A second task, the watchdog, checks every 5 minutes that Seated is still checking. If not, it restarts
# Seated and pushes a notice to your phone (scripts\watchdog.mjs, log in data\watchdog.log).
param([switch]$Remove)

$name = 'Seated radar'
$watchdog = 'Seated watchdog'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $watchdog -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed '$name' and '$watchdog'. Seated no longer starts at login."
  exit 0
}

# cmd's redirection writes the log line by line; PowerShell's *> would buffer it.
$command = "Set-Location '$repo'; cmd /c 'npm start > data\seated.log 2>&1'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Priority 4 = normal. The default (7, below normal) let Windows throttle the radar: checks took 20 minutes
# and requests timed out, while the same check took 21 seconds from a terminal (Oct 2026).
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Priority 4
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

# The watchdog runs through a tiny VBScript so no console window flashes every 5 minutes.
$node = (Get-Command node).Source
$wdArgs = "`"$repo\scripts\windows-hidden.vbs`" `"$node`" --disable-warning=ExperimentalWarning scripts\watchdog.mjs --restart-task `"$name`""
$wdAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $wdArgs -WorkingDirectory $repo
$wdTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
# Priority 4 for the same reason as the radar: at the default, node took 40 s to start and the health request timed out.
$wdSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 4
Register-ScheduledTask -TaskName $watchdog -Action $wdAction -Trigger $wdTrigger -Settings $wdSettings -Force | Out-Null

Write-Output "Seated now starts at login, and '$watchdog' checks on it every 5 minutes."
Write-Output "Start it right away with: Start-ScheduledTask -TaskName '$name'"

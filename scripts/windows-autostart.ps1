# Start Seated in the background every time you log in to Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1            # turn on
#   powershell -ExecutionPolicy Bypass -File scripts\windows-autostart.ps1 -Remove    # turn off
# The log goes to data\seated.log. The dashboard is at http://127.0.0.1:4310.
param([switch]$Remove)

$name = 'Seated radar'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed '$name'. Seated no longer starts at login."
  exit 0
}

$command = "Set-Location '$repo'; npm start *> data\seated.log"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "Seated now starts at login. Start it right away with: Start-ScheduledTask -TaskName '$name'"

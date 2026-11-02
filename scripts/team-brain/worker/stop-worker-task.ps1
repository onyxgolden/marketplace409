# Team Brain P7 — kill switch.
#
# Two halves, both safe to run at any time:
#   1. Portable half: create the stop file. A worker cycle that sees
#      the stop file refuses to start (STOPPED heartbeat, no writes
#      except the heartbeat row). This half works on any host and is
#      what isolated qualification proves.
#   2. Windows half: end a running task instance and disable the
#      task (schtasks /End + /Change /Disable). Skipped with a
#      warning when schtasks is unavailable (non-Windows host).
#
# Parameters:
#   -TaskName : Scheduled task name (e.g. "Team Brain Worker")
#   -StopFile : Stop-file path from the worker config
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$StopFile
)

$ErrorActionPreference = "Stop"

New-Item -ItemType File -Path $StopFile -Force | Out-Null
Write-Output "Stop file created: $StopFile (new cycles refuse to start)."

if (Get-Command schtasks -ErrorAction SilentlyContinue) {
  schtasks /End /TN $TaskName 2>$null
  schtasks /Change /TN $TaskName /Disable
  if ($LASTEXITCODE -ne 0) { throw "schtasks /Change /Disable failed with exit code $LASTEXITCODE" }
  $state = (schtasks /Query /TN $TaskName /FO LIST /V | Select-String "Status:").ToString()
  Write-Output "Task '$TaskName' ended and disabled. $state"
} else {
  Write-Output "WARNING: schtasks unavailable on this host; Windows half skipped. The stop file alone stops new cycles."
}
Write-Output "Kill complete. Remove the stop file only when a restart is authorized."

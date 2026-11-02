# Team Brain P7 — register the worker task DISABLED.
#
# This script registers the task and then IMMEDIATELY disables it.
# It takes no -Enable switch, on purpose: enabling the worker is a
# separately authorized activation (P8 territory), never a side
# effect of registration. If anyone edits this script to enable the
# task, that edit is itself an unauthorized activation.
#
# Parameters (no secrets — database credentials come from the vault
# environment at service start, never from this script):
#   -TaskName     : Scheduled task name (e.g. "Team Brain Worker")
#   -WorkerUser   : Dedicated OS account (e.g. "NT SERVICE\TeamBrainWorker")
#   -NodePath     : Full path to node.exe (Node 24)
#   -WorkerScript : Full path to worker/run.mjs
#   -ConfigPath   : Full path to the validated worker config JSON
#   -WorkingDir   : Working directory for the task
#   -XmlTemplate  : Path to task-definition.xml (this package)
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$WorkerUser,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerScript,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$WorkingDir,
  [Parameter(Mandatory = $true)][string]$XmlTemplate
)

$ErrorActionPreference = "Stop"

$xml = Get-Content -Path $XmlTemplate -Raw
$xml = $xml.Replace("{{WORKER_USER}}", $WorkerUser)
$xml = $xml.Replace("{{NODE_PATH}}", $NodePath)
$xml = $xml.Replace("{{WORKER_SCRIPT}}", $WorkerScript)
$xml = $xml.Replace("{{CONFIG_PATH}}", $ConfigPath)
$xml = $xml.Replace("{{WORKING_DIR}}", $WorkingDir)
if ($xml -match "{{") { throw "Unreplaced placeholder remains in task XML; refusing to register." }

$tmp = Join-Path $env:TEMP "team-brain-worker-task.xml"
Set-Content -Path $tmp -Value $xml -Encoding Unicode

schtasks /Create /TN $TaskName /XML $tmp /F
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed with exit code $LASTEXITCODE" }

# Enforce disabled state regardless of what the XML carried.
schtasks /Change /TN $TaskName /Disable
if ($LASTEXITCODE -ne 0) { throw "schtasks /Change /Disable failed with exit code $LASTEXITCODE" }

$state = (schtasks /Query /TN $TaskName /FO LIST /V | Select-String "Status:").ToString()
Write-Output "Task '$TaskName' registered DISABLED. $state"
Write-Output "Verify: the task must show Status: Disabled. Enabling it requires separate Jason authorization."

#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [string]$RuntimeRoot = "$env:ProgramData\n8n-healthcheck"
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $sourceRoot '.env'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw 'Configure .env first; absolute N8N_DATA and N8N_INSTALL paths are required.' }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Create a private agent configuration file first.' }
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $RuntimeRoot /inheritance:r /grant:r ('*' + $sid + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict runtime permissions.' }
$oldTask = Get-ScheduledTask -TaskName N8nHealthcheckAgent -ErrorAction SilentlyContinue
if ($oldTask -and $oldTask.State -eq 'Running') { Stop-ScheduledTask -TaskName N8nHealthcheckAgent; Start-Sleep -Seconds 2 }
foreach ($name in @('server.cjs','agent.cjs','index.html')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $RuntimeRoot $name) -Force }
$settingsText = Get-Content -LiteralPath $environmentFile -Raw
$settingsText = [regex]::Replace($settingsText, '(?m)^HEALTH_AGENT_CONFIG=.*$', '')
($settingsText + "`r`nHEALTH_AGENT_CONFIG=" + $resolvedConfig + "`r`n") | Set-Content -LiteralPath (Join-Path $RuntimeRoot '.env') -Encoding UTF8
$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + (Join-Path $RuntimeRoot 'agent.cjs') + '"') -WorkingDirectory $RuntimeRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName N8nHealthcheckAgent -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only n8n health monitoring and outbound Cloudflare heartbeat.' -Force | Out-Null
Start-ScheduledTask -TaskName N8nHealthcheckAgent
Write-Host 'N8nHealthcheckAgent installed. No n8n process was restarted.'

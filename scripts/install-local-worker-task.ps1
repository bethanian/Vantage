param(
	[string]$TaskName = "VantageLocalWorkers",
	[string]$EnvFile = ".env.local",
	[string]$Workers = "sync,source,social,media,live,signals,transcript,translation,chat,analysis,caption,preview,export"
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Launcher = Join-Path $Root "scripts\start-local-workers.ps1"
$QuotedLauncher = '"' + $Launcher + '"'
$QuotedEnvFile = '"' + $EnvFile + '"'
$Argument = "-NoProfile -ExecutionPolicy Bypass -File $QuotedLauncher -EnvFile $QuotedEnvFile -Workers `"$Workers`" -Restart"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs the Vantage local worker stack on login." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started scheduled task '$TaskName'."
Write-Host "View status: Get-ScheduledTask -TaskName $TaskName"

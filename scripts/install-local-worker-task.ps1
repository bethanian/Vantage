param(
	[string]$TaskName = "VantageLocalWorkers",
	[string]$EnvFile = ".env.local",
	[string]$Workers = "sync,source,social,media,live,signals,transcript,translation,chat,analysis,caption,preview,export"
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Launcher = Join-Path $Root "scripts\start-local-workers.ps1"
$QuotedLauncher = '"' + $Launcher + '"'
$QuotedEnvFile = '"' + $EnvFile + '"'
$Argument = "-NoProfile -ExecutionPolicy Bypass -File $QuotedLauncher -EnvFile $QuotedEnvFile -Workers `"$Workers`" -Restart"

try {
	$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument -WorkingDirectory $Root
	$Trigger = New-ScheduledTaskTrigger -AtLogOn
	$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

	Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs the Vantage local worker stack on login." -Force -ErrorAction Stop | Out-Null
	Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop

	Write-Host "Installed and started scheduled task '$TaskName'."
	Write-Host "View status: Get-ScheduledTask -TaskName $TaskName"
} catch {
	$StartupFolder = [Environment]::GetFolderPath("Startup")
	$ShortcutPath = Join-Path $StartupFolder "$TaskName.lnk"
	$Shell = New-Object -ComObject WScript.Shell
	$Shortcut = $Shell.CreateShortcut($ShortcutPath)
	$Shortcut.TargetPath = (Get-Command powershell.exe).Source
	$Shortcut.Arguments = $Argument
	$Shortcut.WorkingDirectory = $Root
	$Shortcut.WindowStyle = 7
	$IconPath = Join-Path $Root "static\tray\moon.ico"
	if (Test-Path -LiteralPath $IconPath) {
		$Shortcut.IconLocation = $IconPath
	}
	$Shortcut.Description = "Runs the Vantage local worker stack on login."
	$Shortcut.Save()
	Start-Process -FilePath "powershell.exe" -ArgumentList $Argument -WorkingDirectory $Root -WindowStyle Hidden

	Write-Warning "Scheduled task install was blocked by Windows, so Vantage installed a Startup shortcut instead."
	Write-Host "Installed and started Startup shortcut '$ShortcutPath'."
}

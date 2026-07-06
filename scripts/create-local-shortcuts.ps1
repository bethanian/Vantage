param(
	[string]$EnvFile = ".env.local",
	[string]$AppRoot = "",
	[string]$ShortcutFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Vantage"
)

$ErrorActionPreference = "Stop"

if (!$AppRoot) {
	$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
	$AppRoot = Resolve-Path $AppRoot
}

function Read-EnvFile {
	param([string]$Path)

	$Values = @{}
	if (!(Test-Path -LiteralPath $Path)) { return $Values }
	Get-Content -LiteralPath $Path | ForEach-Object {
		$Line = $_.Trim()
		if (!$Line -or $Line.StartsWith("#") -or !$Line.Contains("=")) { return }
		$Key, $Value = $Line.Split("=", 2)
		$Values[$Key.Trim()] = $Value.Trim().Trim('"')
	}
	return $Values
}

New-Item -ItemType Directory -Force -Path $ShortcutFolder | Out-Null

$Shell = New-Object -ComObject WScript.Shell
$PowerShellPath = (Get-Command powershell.exe).Source
$TrayScript = Join-Path $AppRoot "scripts\vantage-local-tray.ps1"
$IconPath = Join-Path $AppRoot "static\tray\moon.ico"
$EnvPath = Join-Path $AppRoot $EnvFile
$EnvValues = Read-EnvFile $EnvPath

$TrayShortcut = $Shell.CreateShortcut((Join-Path $ShortcutFolder "Vantage Local.lnk"))
$TrayShortcut.TargetPath = $PowerShellPath
$TrayShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TrayScript`" -EnvFile `"$EnvFile`""
$TrayShortcut.WorkingDirectory = $AppRoot
$TrayShortcut.WindowStyle = 7
if (Test-Path -LiteralPath $IconPath) {
	$TrayShortcut.IconLocation = $IconPath
}
$TrayShortcut.Description = "Open the Vantage Local tray controller."
$TrayShortcut.Save()

$DashboardUrl = $EnvValues["VANTAGE_DASHBOARD_URL"]
if ($DashboardUrl) {
	$DashboardShortcutPath = Join-Path $ShortcutFolder "Vantage Dashboard.url"
	$DashboardShortcut = @(
		"[InternetShortcut]",
		"URL=$DashboardUrl"
	)
	if (Test-Path -LiteralPath $IconPath) {
		$DashboardShortcut += "IconFile=$IconPath"
		$DashboardShortcut += "IconIndex=0"
	}
	$DashboardShortcut | Set-Content -Path $DashboardShortcutPath -Encoding ascii
}

Write-Host "Created Start Menu shortcuts in $ShortcutFolder"

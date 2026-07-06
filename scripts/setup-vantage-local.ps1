param(
	[string]$EnvFile = ".env.local",
	[string]$Workers = "sync,source,social,media,live,signals,transcript,translation,chat,analysis,caption,preview,export",
	[string]$MediaRoot = "C:\Vantage",
	[switch]$InstallOnLogin,
	[switch]$StartTray,
	[switch]$Force
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$ConfigureArgs = @("-ExecutionPolicy", "Bypass", "-File", "scripts\configure-local-worker.ps1", "-EnvFile", $EnvFile, "-MediaRoot", $MediaRoot)
if ($Force) { $ConfigureArgs += "-Force" }

Write-Host "Configuring Vantage Local..."
& powershell @ConfigureArgs
if ($LASTEXITCODE) { exit $LASTEXITCODE }

Write-Host "Checking Vantage Local..."
npm.cmd run workers:local:doctor
if ($LASTEXITCODE) { exit $LASTEXITCODE }

Write-Host "Creating Start Menu shortcuts..."
& powershell -ExecutionPolicy Bypass -File scripts\create-local-shortcuts.ps1 -EnvFile $EnvFile
if ($LASTEXITCODE) { exit $LASTEXITCODE }

if ($InstallOnLogin) {
	Write-Host "Installing Vantage Local on login..."
	& powershell -ExecutionPolicy Bypass -File scripts\install-local-worker-task.ps1 -EnvFile $EnvFile -Workers $Workers
	if ($LASTEXITCODE) { exit $LASTEXITCODE }
}

if ($StartTray) {
	Write-Host "Starting tray controller..."
	Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File scripts\vantage-local-tray.ps1 -EnvFile `"$EnvFile`" -Workers `"$Workers`"" -WorkingDirectory $Root -WindowStyle Hidden
}

Write-Host "Vantage Local setup finished."
Write-Host "Tray: npm.cmd run workers:local:tray"
Write-Host "Status: npm.cmd run workers:status"

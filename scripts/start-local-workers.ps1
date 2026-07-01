param(
	[string]$EnvFile = ".env.local",
	[string]$Workers = "sync,source,social,media,live,signals,transcript,translation,chat,analysis,caption,preview,export",
	[switch]$Restart,
	[int]$RestartDelaySeconds = 10
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Import-EnvFile {
	param([string]$Path)

	if (!(Test-Path $Path)) { return }
	Get-Content $Path | ForEach-Object {
		$Line = $_.Trim()
		if (!$Line -or $Line.StartsWith("#") -or !$Line.Contains("=")) { return }
		$Key, $Value = $Line.Split("=", 2)
		[Environment]::SetEnvironmentVariable($Key.Trim(), $Value.Trim().Trim('"'), "Process")
	}
}

function Start-WorkerStack {
	Import-EnvFile $EnvFile
	if (!$env:POSTGRES_URL) {
		Write-Warning "POSTGRES_URL is not set. Local workers will use SQLite and will not process jobs from your hosted Vercel app."
	}
	Write-Host "Starting Vantage local worker stack: $Workers"
	npm.cmd run workers:stack -- --workers=$Workers
	return $LASTEXITCODE
}

if (!$Restart) {
	exit (Start-WorkerStack)
}

while ($true) {
	$ExitCode = Start-WorkerStack
	Write-Warning "Vantage worker stack exited with code $ExitCode. Restarting in $RestartDelaySeconds seconds..."
	Start-Sleep -Seconds $RestartDelaySeconds
}

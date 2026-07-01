param(
	[string]$EnvFile = ".env.local",
	[string]$MediaRoot = "C:\Vantage",
	[switch]$Force
)

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Read-EnvFile {
	param([string]$Path)

	$Values = [ordered]@{}
	if (!(Test-Path $Path)) { return $Values }
	Get-Content $Path | ForEach-Object {
		$Line = $_.Trim()
		if (!$Line -or $Line.StartsWith("#") -or !$Line.Contains("=")) { return }
		$Key, $Value = $Line.Split("=", 2)
		$Values[$Key.Trim()] = $Value.Trim().Trim('"')
	}
	return $Values
}

function Ask-Value {
	param(
		[string]$Key,
		[string]$Prompt,
		[string]$Default = "",
		[bool]$Secret = $false
	)

	if (!$Force -and $Existing.Contains($Key) -and $Existing[$Key]) {
		return $Existing[$Key]
	}

	$Suffix = if ($Default) { " [$Default]" } else { "" }
	if ($Secret) {
		$Secure = Read-Host "$Prompt$Suffix" -AsSecureString
		$Plain = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure))
		return $(if ($Plain) { $Plain } else { $Default })
	}

	$Value = Read-Host "$Prompt$Suffix"
	return $(if ($Value) { $Value } else { $Default })
}

function Require-Tool {
	param([string]$Name)

	if (Get-Command $Name -ErrorAction SilentlyContinue) {
		Write-Host "$Name found"
		return
	}
	Write-Warning "$Name was not found in PATH. Install it before running the full local worker stack."
}

$Existing = Read-EnvFile $EnvFile
$DownloadDir = Join-Path $MediaRoot "downloads"
$TranscriptDir = Join-Path $MediaRoot "transcripts"
$SignalDir = Join-Path $MediaRoot "signals"
$PreviewDir = Join-Path $MediaRoot "previews"
$ExportDir = Join-Path $MediaRoot "exports"
$DefaultInstanceId = if ($Existing["VANTAGE_WORKER_INSTANCE_ID"]) { $Existing["VANTAGE_WORKER_INSTANCE_ID"] } else { "$env:COMPUTERNAME-local" }
$DefaultDownloadDir = if ($Existing["VANTAGE_DOWNLOAD_DIR"]) { $Existing["VANTAGE_DOWNLOAD_DIR"] } else { $DownloadDir }
$DefaultTranscriptDir = if ($Existing["VANTAGE_TRANSCRIPT_DIR"]) { $Existing["VANTAGE_TRANSCRIPT_DIR"] } else { $TranscriptDir }
$DefaultSignalDir = if ($Existing["VANTAGE_MEDIA_SIGNAL_DIR"]) { $Existing["VANTAGE_MEDIA_SIGNAL_DIR"] } else { $SignalDir }
$DefaultPreviewDir = if ($Existing["VANTAGE_PREVIEW_DIR"]) { $Existing["VANTAGE_PREVIEW_DIR"] } else { $PreviewDir }
$DefaultExportDir = if ($Existing["VANTAGE_EXPORT_DIR"]) { $Existing["VANTAGE_EXPORT_DIR"] } else { $ExportDir }
$DefaultGeminiModel = if ($Existing["VANTAGE_GEMINI_MODEL"]) { $Existing["VANTAGE_GEMINI_MODEL"] } else { "gemini-2.5-flash" }
$DefaultSyncInterval = if ($Existing["VANTAGE_SYNC_INTERVAL_MINUTES"]) { $Existing["VANTAGE_SYNC_INTERVAL_MINUTES"] } else { "30" }

$Values = [ordered]@{
	POSTGRES_URL = Ask-Value "POSTGRES_URL" "Hosted Postgres URL" $Existing["POSTGRES_URL"] $true
	YOUTUBE_API_KEY = Ask-Value "YOUTUBE_API_KEY" "YouTube API key" $Existing["YOUTUBE_API_KEY"] $true
	TWITCH_CLIENT_ID = Ask-Value "TWITCH_CLIENT_ID" "Twitch client ID" $Existing["TWITCH_CLIENT_ID"]
	TWITCH_CLIENT_SECRET = Ask-Value "TWITCH_CLIENT_SECRET" "Twitch client secret" $Existing["TWITCH_CLIENT_SECRET"] $true
	KICK_CLIENT_ID = Ask-Value "KICK_CLIENT_ID" "Kick client ID" $Existing["KICK_CLIENT_ID"]
	KICK_CLIENT_SECRET = Ask-Value "KICK_CLIENT_SECRET" "Kick client secret" $Existing["KICK_CLIENT_SECRET"] $true
	GEMINI_API_KEYS = Ask-Value "GEMINI_API_KEYS" "Gemini API keys, comma separated" $Existing["GEMINI_API_KEYS"] $true
	VANTAGE_WORKER_ROLE = "local-primary"
	VANTAGE_WORKER_INSTANCE_ID = Ask-Value "VANTAGE_WORKER_INSTANCE_ID" "Worker instance name" $DefaultInstanceId
	VANTAGE_DOWNLOAD_DIR = Ask-Value "VANTAGE_DOWNLOAD_DIR" "Download folder" $DefaultDownloadDir
	VANTAGE_TRANSCRIPT_DIR = Ask-Value "VANTAGE_TRANSCRIPT_DIR" "Transcript folder" $DefaultTranscriptDir
	VANTAGE_MEDIA_SIGNAL_DIR = Ask-Value "VANTAGE_MEDIA_SIGNAL_DIR" "Signal folder" $DefaultSignalDir
	VANTAGE_PREVIEW_DIR = Ask-Value "VANTAGE_PREVIEW_DIR" "Preview folder" $DefaultPreviewDir
	VANTAGE_EXPORT_DIR = Ask-Value "VANTAGE_EXPORT_DIR" "Export folder" $DefaultExportDir
	VANTAGE_GEMINI_MODEL = $DefaultGeminiModel
	VANTAGE_SYNC_INTERVAL_MINUTES = $DefaultSyncInterval
}

foreach ($Key in @("VANTAGE_DOWNLOAD_DIR", "VANTAGE_TRANSCRIPT_DIR", "VANTAGE_MEDIA_SIGNAL_DIR", "VANTAGE_PREVIEW_DIR", "VANTAGE_EXPORT_DIR")) {
	New-Item -ItemType Directory -Force -Path $Values[$Key] | Out-Null
}

$Lines = foreach ($Pair in $Values.GetEnumerator()) {
	"$($Pair.Key)=$($Pair.Value)"
}
$Lines | Set-Content -Path $EnvFile -Encoding utf8

Require-Tool "node"
Require-Tool "npm"
Require-Tool "ffmpeg"
Require-Tool "yt-dlp"

Write-Host "Wrote $EnvFile"
Write-Host "Smoke test: npm.cmd run workers:local:once"
Write-Host "Install on login: npm.cmd run workers:local:install"

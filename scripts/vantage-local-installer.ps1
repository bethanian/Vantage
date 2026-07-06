param(
	[string]$RepoUrl = "https://github.com/bethanian/Vantage.git",
	[string]$Branch = "main",
	[string]$InstallDir = "$env:LOCALAPPDATA\VantageLocal",
	[string]$DashboardUrl = "",
	[string]$PostgresUrl = "",
	[string]$MediaRoot = "C:\Vantage",
	[switch]$SkipPrerequisites,
	[switch]$NoStartTray
)

$ErrorActionPreference = "Stop"

function Test-Tool {
	param([string]$Name)
	return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
	$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
	$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$env:Path = "$MachinePath;$UserPath"
}

function Invoke-External {
	param(
		[string]$FilePath,
		[string[]]$Arguments,
		[string]$Label
	)

	$PreviousPreference = $ErrorActionPreference
	$ErrorActionPreference = "Continue"
	try {
		& $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
		$ExitCode = $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $PreviousPreference
	}

	if ($ExitCode) {
		throw "$Label failed with exit code $ExitCode."
	}
}

function Install-Tool {
	param(
		[string]$Command,
		[string]$PackageId,
		[string]$Label
	)

	if (Test-Tool $Command) {
		Write-Host "$Label found"
		return
	}

	if (!(Test-Tool "winget")) {
		Write-Warning "$Label is missing and winget is not available. Install $Label, then run this installer again."
		return
	}

	Write-Host "Installing $Label..."
	try {
		Invoke-External "winget" @("install", "--id", $PackageId, "--exact", "--accept-source-agreements", "--accept-package-agreements") "Install $Label"
	} catch {
		Write-Warning "Could not install $Label automatically. Install it manually, then run this installer again."
		return
	}

	Refresh-Path
}

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

function Write-SeedEnv {
	param(
		[string]$Path,
		[string]$Dashboard,
		[string]$Postgres
	)

	if (!$Dashboard -and !$Postgres) { return }

	$Values = Read-EnvFile $Path
	if ($Dashboard) { $Values["VANTAGE_DASHBOARD_URL"] = $Dashboard }
	if ($Postgres) { $Values["POSTGRES_URL"] = $Postgres }

	$Lines = foreach ($Pair in $Values.GetEnumerator()) {
		"$($Pair.Key)=$($Pair.Value)"
	}
	$Lines | Set-Content -Path $Path -Encoding utf8
}

Write-Host ""
Write-Host "Vantage Local Setup"
Write-Host "Install folder: $InstallDir"
Write-Host ""

if (!$SkipPrerequisites) {
	Install-Tool "git" "Git.Git" "Git"
	Install-Tool "node" "OpenJS.NodeJS.LTS" "Node.js"
	Install-Tool "ffmpeg" "Gyan.FFmpeg" "FFmpeg"
	Install-Tool "yt-dlp" "yt-dlp.yt-dlp" "yt-dlp"
	Refresh-Path
}

if (!(Test-Tool "git")) { throw "Git is required before Vantage can be installed." }
if (!(Test-Tool "node")) { throw "Node.js is required before Vantage can be installed." }
if (!(Test-Tool "npm")) { throw "npm is required before Vantage can be installed." }

$InstallParent = Split-Path -Parent $InstallDir
New-Item -ItemType Directory -Force -Path $InstallParent | Out-Null

if (Test-Path (Join-Path $InstallDir ".git")) {
	Write-Host "Updating Vantage..."
	Invoke-External "git" @("-C", $InstallDir, "fetch", "--all", "--prune") "Git fetch"
	$CurrentBranch = (& git -C $InstallDir branch --show-current).Trim()
	if ($CurrentBranch -ne $Branch) {
		Invoke-External "git" @("-C", $InstallDir, "checkout", $Branch) "Git checkout"
	} else {
		Write-Host "Already on $Branch"
	}
	Invoke-External "git" @("-C", $InstallDir, "pull", "--ff-only") "Git pull"
} elseif (Test-Path $InstallDir) {
	throw "Install folder already exists but is not a Vantage checkout: $InstallDir"
} else {
	Write-Host "Downloading Vantage..."
	Invoke-External "git" @("clone", "--branch", $Branch, $RepoUrl, $InstallDir) "Git clone"
}

Set-Location $InstallDir

Write-Host "Installing app packages..."
Invoke-External "npm.cmd" @("install") "npm install"

Write-SeedEnv -Path ".env.local" -Dashboard $DashboardUrl -Postgres $PostgresUrl

$SetupArgs = @(
	"-ExecutionPolicy", "Bypass",
	"-File", "scripts\setup-vantage-local.ps1",
	"-EnvFile", ".env.local",
	"-MediaRoot", $MediaRoot,
	"-InstallOnLogin"
)

if (!$NoStartTray) { $SetupArgs += "-StartTray" }

Write-Host "Configuring local workers..."
& powershell @SetupArgs
if ($LASTEXITCODE) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Vantage Local is ready."
Write-Host "Dashboard: $DashboardUrl"
Write-Host "Tray app: Start Menu login task plus local tray controller"

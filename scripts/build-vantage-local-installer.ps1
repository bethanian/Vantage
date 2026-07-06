param(
	[string]$OutputPath = "dist\VantageLocalSetup.exe",
	[switch]$InstallPs2Exe,
	[string]$CertificateThumbprint = $env:VANTAGE_SIGN_CERT_THUMBPRINT,
	[string]$CertificatePath = $env:VANTAGE_SIGN_CERT_PFX,
	[string]$CertificatePassword = $env:VANTAGE_SIGN_CERT_PASSWORD,
	[string]$TimestampServer = "http://timestamp.digicert.com",
	[switch]$SkipSigning
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstallerScript = Join-Path $Root "scripts\vantage-local-installer.ps1"
$IconPath = Join-Path $Root "static\tray\moon.ico"
$ResolvedOutputPath = Join-Path $Root $OutputPath
$OutputDir = Split-Path -Parent $ResolvedOutputPath

Set-Location $Root
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (!(Test-Path $InstallerScript)) {
	throw "Missing installer script: $InstallerScript"
}

if ($InstallPs2Exe -and !(Get-Module -ListAvailable -Name ps2exe)) {
	Write-Host "Installing ps2exe for the current Windows user..."
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	if (!(Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
		Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null
	}
	Install-Module ps2exe -Scope CurrentUser -Force -AllowClobber
}

$Command = Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue
if (!$Command) {
	$Command = Get-Command ps2exe -ErrorAction SilentlyContinue
}

if (!$Command) {
	throw "ps2exe is required to build the EXE. Run: powershell -ExecutionPolicy Bypass -File scripts\build-vantage-local-installer.ps1 -InstallPs2Exe"
}

$Ps2ExeArgs = @{
	inputFile = $InstallerScript
	outputFile = $ResolvedOutputPath
	title = "Vantage Local Setup"
	description = "Installs and configures Vantage local workers."
	company = "Vantage"
	product = "Vantage Local"
	version = "1.0.0.0"
	noConsole = $false
}

if (Test-Path $IconPath) {
	$Ps2ExeArgs["iconFile"] = $IconPath
}

Write-Host "Building $ResolvedOutputPath..."
& $Command @Ps2ExeArgs

if (!(Test-Path $ResolvedOutputPath)) {
	throw "Installer build finished without creating $ResolvedOutputPath"
}

Write-Host "Built installer: $ResolvedOutputPath"

if ($SkipSigning) {
	Write-Host "Skipped code signing."
	exit 0
}

$Certificate = $null
if ($CertificatePath) {
	if (!(Test-Path $CertificatePath)) {
		throw "Certificate file was not found: $CertificatePath"
	}

	if (!$CertificatePassword) {
		throw "CertificatePassword or VANTAGE_SIGN_CERT_PASSWORD is required when using a PFX file."
	}

	Write-Host "Importing signing certificate..."
	$SecurePassword = ConvertTo-SecureString $CertificatePassword -AsPlainText -Force
	$Certificate = Import-PfxCertificate -FilePath $CertificatePath -CertStoreLocation Cert:\CurrentUser\My -Password $SecurePassword
} elseif ($CertificateThumbprint) {
	$NormalizedThumbprint = $CertificateThumbprint.Replace(" ", "")
	$Certificate = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
		$_.Thumbprint -eq $NormalizedThumbprint
	} | Select-Object -First 1
}

if (!$Certificate) {
	Write-Warning "Installer was built but not signed. Set VANTAGE_SIGN_CERT_THUMBPRINT or VANTAGE_SIGN_CERT_PFX to sign the EXE."
	exit 0
}

Write-Host "Signing installer..."
$Signature = Set-AuthenticodeSignature -FilePath $ResolvedOutputPath -Certificate $Certificate -TimestampServer $TimestampServer -HashAlgorithm SHA256

if ($Signature.Status -ne "Valid") {
	throw "Code signing failed: $($Signature.Status) $($Signature.StatusMessage)"
}

Write-Host "Signed installer: $ResolvedOutputPath"

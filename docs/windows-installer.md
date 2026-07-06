# Vantage Local Windows Installer

The Windows installer is a small EXE wrapper around `scripts/vantage-local-installer.ps1`.
It downloads the Vantage repo, installs local dependencies, runs the local worker setup, installs the login task, and starts the tray controller.

## Build the EXE

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-vantage-local-installer.ps1 -InstallPs2Exe
```

The output is:

```text
dist\VantageLocalSetup.exe
```

Upload that file to a GitHub Release. Teammates only need to download and run the EXE.

## Code signing

For a release EXE that Windows trusts, sign with a real code-signing certificate. A self-signed certificate can prove the file was not changed after signing, but it will not remove SmartScreen warnings for teammates unless their PCs trust that certificate.

With a certificate already installed in your Windows user certificate store:

```powershell
$env:VANTAGE_SIGN_CERT_THUMBPRINT = "YOUR_CERT_THUMBPRINT"
powershell -ExecutionPolicy Bypass -File scripts\build-vantage-local-installer.ps1
```

With a `.pfx` certificate file:

```powershell
$env:VANTAGE_SIGN_CERT_PFX = "C:\Path\to\certificate.pfx"
$env:VANTAGE_SIGN_CERT_PASSWORD = "certificate-password"
powershell -ExecutionPolicy Bypass -File scripts\build-vantage-local-installer.ps1
```

For a temporary unsigned internal build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-vantage-local-installer.ps1 -SkipSigning
```

## What teammates will enter

The installer can automate the machine setup, but each PC still needs the private Vantage values:

- hosted Postgres URL
- dashboard URL
- YouTube API key
- Twitch client ID and secret
- Kick client ID and secret
- Gemini API keys
- local media folders

Do not bake secrets into the EXE. If you want a smoother private rollout, share those values through your team's password manager and have each teammate paste them into the installer prompts.

## Installer options

The EXE accepts the same options as the script:

```powershell
VantageLocalSetup.exe -DashboardUrl "https://your-dashboard.example" -PostgresUrl "postgres://..."
```

Useful options:

- `-RepoUrl`: Git repo to install from. Defaults to `https://github.com/bethanian/Vantage.git`.
- `-Branch`: branch to install. Defaults to `main`.
- `-InstallDir`: local install folder. Defaults to `%LOCALAPPDATA%\VantageLocal`.
- `-DashboardUrl`: pre-fills the dashboard URL prompt.
- `-PostgresUrl`: pre-fills the hosted database prompt.
- `-MediaRoot`: local processing folder root. Defaults to `C:\Vantage`.
- `-SkipPrerequisites`: skips automatic prerequisite installation.
- `-NoStartTray`: installs the login task without immediately starting the tray app.

## What it installs

The installer checks or installs:

- Git
- Node.js LTS
- FFmpeg
- yt-dlp

Then it installs the app packages, writes `.env.local`, runs the local worker doctor, registers the local worker stack on login, and starts the tray controller.

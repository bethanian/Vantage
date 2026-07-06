param(
	[string]$EnvFile = ".env.local",
	[string]$Workers = "sync,source,social,media,live,signals,transcript,translation,chat,analysis,caption,preview,export",
	[string]$IconPath = "static\tray\moon.ico",
	[string]$DashboardUrl = $env:VANTAGE_DASHBOARD_URL
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Launcher = Join-Path $Root "scripts\start-local-workers.ps1"
$ResolvedIconPath = Join-Path $Root $IconPath
$Script:WorkerProcess = $null

function Import-EnvFile {
	param([string]$Path)

	$ResolvedPath = Join-Path $Root $Path
	if (!(Test-Path -LiteralPath $ResolvedPath)) { return }
	Get-Content -LiteralPath $ResolvedPath | ForEach-Object {
		$Line = $_.Trim()
		if (!$Line -or $Line.StartsWith("#") -or !$Line.Contains("=")) { return }
		$Key, $Value = $Line.Split("=", 2)
		[Environment]::SetEnvironmentVariable($Key.Trim(), $Value.Trim().Trim('"'), "Process")
	}
}

Import-EnvFile $EnvFile
$Dashboard = if ($DashboardUrl) { $DashboardUrl } elseif ($env:VANTAGE_DASHBOARD_URL) { $env:VANTAGE_DASHBOARD_URL } else { "http://localhost:5173" }

function New-VantageIcon {
	if (Test-Path -LiteralPath $ResolvedIconPath) {
		return New-Object System.Drawing.Icon($ResolvedIconPath)
	}

	$Bitmap = New-Object System.Drawing.Bitmap(64, 64)
	$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
	$Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$Graphics.Clear([System.Drawing.Color]::Transparent)
	$Brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(43, 92, 58))
	$Graphics.FillEllipse($Brush, 4, 4, 56, 56)
	$Font = New-Object System.Drawing.Font("Georgia", 32, [System.Drawing.FontStyle]::Italic)
	$TextBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(199, 230, 207))
	$Format = New-Object System.Drawing.StringFormat
	$Format.Alignment = [System.Drawing.StringAlignment]::Center
	$Format.LineAlignment = [System.Drawing.StringAlignment]::Center
	$Graphics.DrawString("V", $Font, $TextBrush, [System.Drawing.RectangleF]::new(0, 2, 64, 60), $Format)
	$Graphics.Dispose()
	$Handle = $Bitmap.GetHicon()
	return [System.Drawing.Icon]::FromHandle($Handle)
}

function Start-VantageWorkers {
	if ($Script:WorkerProcess -and !$Script:WorkerProcess.HasExited) {
		[System.Windows.Forms.MessageBox]::Show("Vantage Local is already running.", "Vantage Local") | Out-Null
		return
	}

	$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`" -EnvFile `"$EnvFile`" -Workers `"$Workers`" -Restart"
	$Script:WorkerProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
	$NotifyIcon.Text = "Vantage Local running"
	$NotifyIcon.ShowBalloonTip(2500, "Vantage Local", "Local processing workers started.", [System.Windows.Forms.ToolTipIcon]::Info)
}

function Stop-VantageWorkers {
	if (!$Script:WorkerProcess -or $Script:WorkerProcess.HasExited) {
		[System.Windows.Forms.MessageBox]::Show("Vantage Local is not running from this tray session.", "Vantage Local") | Out-Null
		return
	}

	Stop-Process -Id $Script:WorkerProcess.Id -Force
	$Script:WorkerProcess = $null
	$NotifyIcon.Text = "Vantage Local stopped"
	$NotifyIcon.ShowBalloonTip(2500, "Vantage Local", "Local processing workers stopped.", [System.Windows.Forms.ToolTipIcon]::Warning)
}

function Show-VantageStatus {
	if ($Script:WorkerProcess -and $Script:WorkerProcess.HasExited) {
		$Status = "stopped, last worker stack exit code $($Script:WorkerProcess.ExitCode)"
		$NotifyIcon.Text = "Vantage Local stopped"
	} elseif ($Script:WorkerProcess) {
		$Status = "running, pid $($Script:WorkerProcess.Id)"
	} else {
		$Status = "tray ready, workers not started from this tray session"
	}
	[System.Windows.Forms.MessageBox]::Show("Vantage Local is $Status.`nWorkers: $Workers`nEnv: $EnvFile", "Vantage Local") | Out-Null
}

$NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$NotifyIcon.Icon = New-VantageIcon
$NotifyIcon.Text = "Vantage Local"
$NotifyIcon.Visible = $true

$Menu = New-Object System.Windows.Forms.ContextMenuStrip
$OpenItem = $Menu.Items.Add("Open dashboard")
$StartItem = $Menu.Items.Add("Start local processing")
$StopItem = $Menu.Items.Add("Stop local processing")
$StatusItem = $Menu.Items.Add("Status")
$Menu.Items.Add("-") | Out-Null
$ExitItem = $Menu.Items.Add("Exit")

$OpenItem.Add_Click({ Start-Process $Dashboard })
$StartItem.Add_Click({ Start-VantageWorkers })
$StopItem.Add_Click({ Stop-VantageWorkers })
$StatusItem.Add_Click({ Show-VantageStatus })
$ExitItem.Add_Click({
	if ($Script:WorkerProcess -and !$Script:WorkerProcess.HasExited) {
		Stop-Process -Id $Script:WorkerProcess.Id -Force
	}
	$NotifyIcon.Visible = $false
	[System.Windows.Forms.Application]::Exit()
})

$NotifyIcon.ContextMenuStrip = $Menu
$NotifyIcon.Add_DoubleClick({ Start-Process $Dashboard })
$NotifyIcon.ShowBalloonTip(2500, "Vantage Local", "Tray control is ready. Right-click for local processing controls.", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()

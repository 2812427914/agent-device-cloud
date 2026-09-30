# Generated release installer. Publish alongside manifest.json and the archives.
[CmdletBinding()]
param(
  [string]$Url = "",
  [string]$Code = "",
  [string]$DownloadUrl = "",
  [string]$Label = "",
  [string]$RootPath = "",
  [string]$RootId = "",
  [ValidateSet("", "none", "selected", "home", "full")]
  [string]$Access = "",
  [switch]$ReadOnly,
  [switch]$NoService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Fail([string]$Message) {
  throw "ADC: $Message"
}

function Assert-DownloadUrl([string]$Value) {
  try {
    $Parsed = [Uri]$Value
  } catch {
    Fail "Download URL is invalid."
  }
  $Loopback = $Parsed.Host -in @("localhost", "127.0.0.1", "::1")
  if ($Parsed.Scheme -ne "https" -and -not ($Parsed.Scheme -eq "http" -and $Loopback)) {
    Fail "Download URL requires HTTPS (HTTP is allowed on loopback for local use)."
  }
  if (-not [string]::IsNullOrEmpty($Parsed.UserInfo) -or
      -not [string]::IsNullOrEmpty($Parsed.Query) -or
      -not [string]::IsNullOrEmpty($Parsed.Fragment)) {
    Fail "Download URL must not contain credentials, query parameters or fragments."
  }
}

function Assert-LocalPath([string]$Value, [string]$Name) {
  if (-not [IO.Path]::IsPathRooted($Value)) {
    Fail "$Name must be absolute."
  }
  if ($Value.StartsWith("\\") -or $Value.StartsWith("//")) {
    Fail "$Name must be on a local drive; UNC paths are not supported."
  }
}

function Write-Utf8([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Escape-Cmd([string]$Value) {
  return $Value.Replace("%", "%%")
}

$DefaultDownloadUrl = @ADC_DOWNLOAD_URL@
if ([string]::IsNullOrWhiteSpace($DownloadUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($DefaultDownloadUrl)) {
    $DownloadUrl = $DefaultDownloadUrl
  } elseif (-not [string]::IsNullOrWhiteSpace($Url)) {
    $DownloadUrl = "$($Url.TrimEnd('/'))/downloads/node"
  } else {
    Fail "Use -Url ORIGIN or -DownloadUrl URL."
  }
}
Assert-DownloadUrl $DownloadUrl

if (-not [Environment]::Is64BitOperatingSystem -or
    -not [Environment]::Is64BitProcess) {
  Fail "This release requires 64-bit Windows 10 or Windows 11."
}
$NativeArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
  $env:PROCESSOR_ARCHITEW6432
} else {
  $env:PROCESSOR_ARCHITECTURE
}
if ($NativeArchitecture -ne "AMD64") {
  Fail "This release supports x64 Windows only."
}

$Archives = @{
@ADC_ARCHIVES@
}
$Archive = $Archives["win32-x64"]
if ($null -eq $Archive) {
  Fail "This release does not contain win32-x64."
}

$LocalAppData = [Environment]::GetFolderPath("LocalApplicationData")
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
  Fail "LOCALAPPDATA is unavailable."
}
$InstallDir = if ($env:ADC_INSTALL_DIR) {
  $env:ADC_INSTALL_DIR
} else {
  Join-Path $LocalAppData "Programs\AgentDeviceCloud"
}
$BinDir = if ($env:ADC_BIN_DIR) {
  $env:ADC_BIN_DIR
} else {
  Join-Path $LocalAppData "AgentDeviceCloud\bin"
}
$ConfigPath = if ($env:ADC_NODE_CONFIG) {
  $env:ADC_NODE_CONFIG
} else {
  Join-Path $LocalAppData "AgentDeviceCloud\config\node.json"
}
Assert-LocalPath $InstallDir "ADC_INSTALL_DIR"
Assert-LocalPath $BinDir "ADC_BIN_DIR"
Assert-LocalPath $ConfigPath "ADC_NODE_CONFIG"

$Marker = Join-Path $InstallDir ".adc-installation"
if ((Test-Path -LiteralPath $InstallDir) -and -not (Test-Path -LiteralPath $Marker)) {
  Fail "$InstallDir exists but is not an ADC installation. Choose a new ADC_INSTALL_DIR."
}
[IO.Directory]::CreateDirectory($InstallDir) | Out-Null
[IO.Directory]::CreateDirectory($BinDir) | Out-Null
Write-Utf8 $Marker "Agent Device Cloud`n"

$LockDir = Join-Path $InstallDir ".install-lock"
try {
  try {
    New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
  } catch {
    if (-not (Test-Path -LiteralPath $LockDir -PathType Container)) {
      throw
    }
    $ExistingPidFile = Join-Path $LockDir "pid"
    $ExistingPid = 0
    if (Test-Path -LiteralPath $ExistingPidFile) {
      [void][int]::TryParse(
        ([IO.File]::ReadAllText($ExistingPidFile).Trim()),
        [ref]$ExistingPid
      )
    }
    if ($ExistingPid -gt 0 -and
        (Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue)) {
      Fail "Another installation is active (PID $ExistingPid)."
    }
    Remove-Item -LiteralPath $LockDir -Recurse -Force
    New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
  }
  $LockFile = Join-Path $LockDir "pid"
  Write-Utf8 $LockFile ([string]$PID)
} catch {
  Fail "Could not acquire the installation lock at $LockDir. $($_.Exception.Message)"
}

$Temporary = Join-Path $InstallDir (".download." + [Guid]::NewGuid().ToString("N"))
try {
  [IO.Directory]::CreateDirectory($Temporary) | Out-Null
  foreach ($Name in @("adc.cmd", "adc-node.cmd")) {
    $Launcher = Join-Path $BinDir $Name
    if ((Test-Path -LiteralPath $Launcher) -and
        -not ([IO.File]::ReadAllText($Launcher).Contains("REM ADC managed launcher"))) {
      Fail "$Launcher already exists and is not managed by ADC."
    }
  }

  $ArchivePath = Join-Path $Temporary "client.zip"
  Write-Host "Downloading Agent Device Cloud for win32-x64..."
  Invoke-WebRequest -UseBasicParsing -Uri "$($DownloadUrl.TrimEnd('/'))/$($Archive.File)" `
    -OutFile $ArchivePath
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
  if ($Actual -ne $Archive.Sha256) {
    Fail "Archive checksum mismatch. Existing release was preserved."
  }

  $Payload = Join-Path $Temporary "payload"
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Payload
  $Runtime = Join-Path $Payload "runtime\bin\node.exe"
  & $Runtime "--version" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail "Bundled runtime cannot run on this operating system."
  }

  $env:ADC_INSTALL_DIR = $InstallDir
  $env:ADC_BIN_DIR = $BinDir
  $env:ADC_NODE_CONFIG = $ConfigPath
  $SetupArgs = @((Join-Path $Payload "lib\adc-node.mjs"), "setup")
  if ($Url) { $SetupArgs += @("--url", $Url) }
  if ($Code) { $SetupArgs += @("--code", $Code) }
  if ($Label) { $SetupArgs += @("--label", $Label) }
  if ($RootPath) { $SetupArgs += @("--root-path", $RootPath) }
  if ($RootId) { $SetupArgs += @("--root-id", $RootId) }
  if ($Access) { $SetupArgs += @("--access", $Access) }
  if ($ReadOnly) { $SetupArgs += "--read-only" }
  $SetupArgs += "--no-service"
  & $Runtime @SetupArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "Device setup failed. Existing release was preserved."
  }

  $ReleaseName = [IO.Path]::GetFileNameWithoutExtension($Archive.File)
  $ReleasesDir = Join-Path $InstallDir "releases"
  $ReleaseDir = Join-Path $ReleasesDir $ReleaseName
  [IO.Directory]::CreateDirectory($ReleasesDir) | Out-Null
  if (Test-Path -LiteralPath $ReleaseDir) {
    Remove-Item -LiteralPath $Payload -Recurse -Force
  } else {
    Move-Item -LiteralPath $Payload -Destination $ReleaseDir
  }

  $CurrentPath = Join-Path $InstallDir "current.txt"
  $PreviousRelease = if (Test-Path -LiteralPath $CurrentPath) {
    [IO.File]::ReadAllText($CurrentPath).Trim()
  } else {
    ""
  }
  $NextPath = Join-Path $InstallDir ".current.next"
  Write-Utf8 $NextPath $ReleaseName
  if (Test-Path -LiteralPath $CurrentPath) {
    [IO.File]::Replace($NextPath, $CurrentPath, $null)
  } else {
    Move-Item -LiteralPath $NextPath -Destination $CurrentPath
  }

  $EscapedInstall = Escape-Cmd $InstallDir
  $EscapedBin = Escape-Cmd $BinDir
  $EscapedDownload = Escape-Cmd $DownloadUrl
  $EscapedConfig = Escape-Cmd $ConfigPath
  $ControlPlaneLine = if ($Url) {
    "set `"ADC_CONTROL_PLANE_URL=$(Escape-Cmd $Url)`"`r`n"
  } else {
    ""
  }
  $ServiceLine = if ($env:ADC_SERVICE_DIR) {
    "set `"ADC_SERVICE_DIR=$(Escape-Cmd $env:ADC_SERVICE_DIR)`"`r`n"
  } else {
    ""
  }
  foreach ($Name in @("adc", "adc-node")) {
    $Content = "@echo off`r`n" +
      "REM ADC managed launcher`r`n" +
      "chcp 65001 >nul`r`n" +
      "setlocal DisableDelayedExpansion`r`n" +
      "set `"ADC_INSTALL_DIR=$EscapedInstall`"`r`n" +
      "set `"ADC_BIN_DIR=$EscapedBin`"`r`n" +
      "set `"ADC_UPDATE_URL=$EscapedDownload`"`r`n" +
      $ControlPlaneLine +
      "if not defined ADC_NODE_CONFIG set `"ADC_NODE_CONFIG=$EscapedConfig`"`r`n" +
      $ServiceLine +
      "for /f `"usebackq delims=`" %%R in (`"%ADC_INSTALL_DIR%\current.txt`") do set `"ADC_RELEASE=%%R`"`r`n" +
      "`"%ADC_INSTALL_DIR%\releases\%ADC_RELEASE%\runtime\bin\node.exe`" " +
      "`"%ADC_INSTALL_DIR%\releases\%ADC_RELEASE%\lib\$Name.mjs`" %*`r`n" +
      "exit /b %ERRORLEVEL%`r`n"
    Write-Utf8 (Join-Path $BinDir "$Name.cmd") $Content
  }

  if (-not $NoService) {
    & (Join-Path $BinDir "adc-node.cmd") "setup"
    if ($LASTEXITCODE -ne 0) {
      if ($PreviousRelease) {
        Write-Utf8 $NextPath $PreviousRelease
        [IO.File]::Replace($NextPath, $CurrentPath, $null)
        & (Join-Path $BinDir "adc-node.cmd") "setup" | Out-Null
      }
      Fail "Connector restart failed. The previous release was restored."
    }
  }

  Write-Host ""
  Write-Host "Installed: $(Join-Path $BinDir 'adc-node.cmd')"
  $PathEntries = $env:PATH -split ";"
  if ($BinDir -notin $PathEntries) {
    Write-Host "Add this directory to your user PATH: $BinDir"
  }
  Write-Host "Status: & '$(Join-Path $BinDir 'adc-node.cmd')' status"
} finally {
  if (Test-Path -LiteralPath $Temporary) {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath (Join-Path $LockDir "pid") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $LockDir -Force -ErrorAction SilentlyContinue
}

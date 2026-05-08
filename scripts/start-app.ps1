param(
  [switch]$NoBuild,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$frontendUrl = if ([string]::IsNullOrWhiteSpace($env:FRONTEND_APP_URL)) { 'http://127.0.0.1:8080' } else { $env:FRONTEND_APP_URL }

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$dockerMode = $null
$wslProjectRoot = $null

function Get-WslArgs {
  if ([string]::IsNullOrWhiteSpace($env:WSL_DISTRO)) { return @() }
  return @('-d', $env:WSL_DISTRO, '--')
}

function Invoke-WslCapture {
  param([string]$Command)
  $args = @(Get-WslArgs) + @('sh', '-lc', $Command)
  return & wsl.exe @args 2>&1
}

function Get-WslProjectRoot {
  if (-not [string]::IsNullOrWhiteSpace($script:wslProjectRoot)) { return $script:wslProjectRoot }
  $args = @(Get-WslArgs) + @('wslpath', '-a', $projectRoot)
  $path = (& wsl.exe @args 2>$null | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($path)) {
    throw 'Impossibile risolvere il percorso progetto dentro WSL.'
  }
  $script:wslProjectRoot = $path.Trim()
  return $script:wslProjectRoot
}

function Quote-Sh {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Test-DockerReady {
  try {
    docker info *> $null
    return $true
  } catch {
    return $false
  }
}

function Test-WslDockerReady {
  try {
    $dockerPath = Invoke-WslCapture 'command -v docker'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerPath)) { return $false }
    $dockerPathText = ($dockerPath | Out-String).Trim()
    if ($dockerPathText -match '/mnt/wsl/docker-desktop' -or $dockerPathText -match '/mnt/c/.+docker') { return $false }

    $info = Invoke-WslCapture "docker info --format 'name={{.Name}} os={{.OperatingSystem}} root={{.DockerRootDir}}'"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($info)) { return $false }
    $infoText = ($info | Out-String).Trim()
    if ($infoText -match 'Docker Desktop' -or $infoText -match 'docker-desktop') { return $false }
    return $true
  } catch {
    return $false
  }
}

function Invoke-ComposeCommand {
  param([string]$Command)
  if ($script:dockerMode -eq 'wsl') {
    $root = Quote-Sh (Get-WslProjectRoot)
    $args = @(Get-WslArgs) + @('sh', '-lc', "cd $root && docker compose $Command")
    & wsl.exe @args
    return
  }
  $parts = $Command -split '\s+'
  docker compose @parts
}

function Invoke-ComposeCapture {
  param([string]$Command)
  if ($script:dockerMode -eq 'wsl') {
    $root = Quote-Sh (Get-WslProjectRoot)
    $args = @(Get-WslArgs) + @('sh', '-lc', "cd $root && docker compose $Command")
    return & wsl.exe @args 2>$null
  }
  $parts = $Command -split '\s+'
  return docker compose @parts 2>$null
}

function Test-AppReady {
  try {
    $api = curl.exe -s http://localhost:3000/health
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($api)) { return $false }
    $web = curl.exe -s -I $frontendUrl
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($web)) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Open-AppUrl {
  if (-not $OpenBrowser) { return }
  try {
    Start-Process $frontendUrl -ErrorAction Stop | Out-Null
    return
  } catch {
    try {
      Start-Process 'explorer.exe' $frontendUrl -ErrorAction Stop | Out-Null
      return
    } catch {
      Write-Host "Impossibile aprire il browser automaticamente. Apri manualmente: $frontendUrl" -ForegroundColor Yellow
    }
  }
}

if (Test-AppReady) {
  Write-Host "App gia pronta: $frontendUrl" -ForegroundColor Green
  Open-AppUrl
  exit 0
}

if (Test-WslDockerReady) {
  $script:dockerMode = 'wsl'
  Write-Host 'Docker mode: WSL/Linux Docker Engine' -ForegroundColor Cyan
} elseif ($env:ALLOW_DOCKER_DESKTOP_FALLBACK -eq 'true' -and (Test-DockerReady)) {
  $script:dockerMode = 'windows'
  Write-Host 'Docker mode: Windows Docker CLI (explicit fallback)' -ForegroundColor Yellow
} else {
  throw @'
Docker daemon non disponibile.
Avvia Docker Engine dentro WSL/Linux, poi riesegui il comando.
Docker Desktop non è richiesto e non viene usato salvo ALLOW_DOCKER_DESKTOP_FALLBACK=true.

Esempi:
- WSL Ubuntu: sudo service docker start
- Verifica: wsl sh -lc "docker info"
- Fallback esplicito Desktop: ALLOW_DOCKER_DESKTOP_FALLBACK=true npm run app:start
'@
}

$composeCommand = 'up -d'
if (-not $NoBuild) {
  $composeCommand = "$composeCommand --build"
}

Invoke-ComposeCommand $composeCommand

$deadline = (Get-Date).AddSeconds(180)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  $json = Invoke-ComposeCapture 'ps --format json'
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
    Start-Sleep -Seconds 2
    continue
  }

  $services = $json | ConvertFrom-Json
  if ($services -isnot [System.Array]) {
    $services = @($services)
  }

  $server = $services | Where-Object { $_.Service -eq 'server' }
  $frontend = $services | Where-Object { $_.Service -eq 'frontend' }

  $serverOk = $server -and $server.State -eq 'running' -and ($server.Health -eq 'healthy' -or [string]::IsNullOrWhiteSpace($server.Health))
  $frontOk = $frontend -and $frontend.State -eq 'running'

  if ($serverOk -and $frontOk) {
    $healthy = $true
    break
  }

  Start-Sleep -Seconds 2
}

if (-not $healthy) {
  Write-Host 'Servizi non pronti entro timeout. Ultimo stato:' -ForegroundColor Yellow
  Invoke-ComposeCommand 'ps'
  throw 'Startup incompleto.'
}

$health = curl.exe -s http://localhost:3000/health
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($health)) {
  throw 'Health endpoint non raggiungibile.'
}

Write-Host "App pronta: $frontendUrl" -ForegroundColor Green
Open-AppUrl


param(
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Test-DockerReady {
  try {
    docker info *> $null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-DockerReady)) {
  Write-Host 'Docker daemon non disponibile. Avvio Docker Desktop...'
  try {
    Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' | Out-Null
  } catch {
    throw 'Docker Desktop non trovato. Installa Docker Desktop o avvialo manualmente.'
  }

  $maxWaitSec = 120
  $elapsed = 0
  while (-not (Test-DockerReady)) {
    Start-Sleep -Seconds 3
    $elapsed += 3
    if ($elapsed -ge $maxWaitSec) {
      throw 'Docker daemon non raggiungibile entro 120s.'
    }
  }
}

$composeArgs = @('compose', 'up', '-d')
if (-not $NoBuild) {
  $composeArgs += '--build'
}

docker @composeArgs

$deadline = (Get-Date).AddSeconds(180)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  $json = docker compose ps --format json 2>$null
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
  docker compose ps
  throw 'Startup incompleto.'
}

$health = curl.exe -s http://localhost:3000/health
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($health)) {
  throw 'Health endpoint non raggiungibile.'
}

Write-Host 'App pronta: http://localhost' -ForegroundColor Green
Start-Process 'http://localhost' | Out-Null

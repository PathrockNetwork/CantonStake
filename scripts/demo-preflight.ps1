param(
  [switch]$RunBuilds
)

$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Detail
  )

  $Checks.Add([pscustomobject]@{
    Check = $Name
    Status = if ($Ok) { "ok" } else { "missing" }
    Detail = $Detail
  }) | Out-Null
}

function Test-Tool {
  param([string]$Name)

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  Add-Check "tool:$Name" ([bool]$cmd) ($(if ($cmd) { $cmd.Source } else { "not on PATH" }))
}

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }
    $parts = $trimmed -split "=", 2
    if ($parts.Length -eq 2) {
      $values[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
  return $values
}

function Test-EnvValue {
  param(
    [hashtable]$Values,
    [string]$Key,
    [string]$Label = $Key
  )

  $value = $Values[$Key]
  $ok = -not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch "\.\.\."
  Add-Check "env:$Label" $ok ($(if ($ok) { "set" } else { "empty or placeholder" }))
}

Push-Location $Root
try {
  Test-Tool "node"
  Test-Tool "npm"
  Test-Tool "git"
  Test-Tool "docker"
  Test-Tool "daml"

  $rootEnvPath = Join-Path $Root ".env"
  $backendEnvPath = Join-Path $Root "backend\.env"
  $frontendEnvPath = Join-Path $Root "frontend\.env.local"
  $evmEnvPath = Join-Path $Root "evm\.env"

  Add-Check "file:.env" (Test-Path $rootEnvPath) "root compose env"
  Add-Check "file:backend/.env" (Test-Path $backendEnvPath) "backend local env"
  Add-Check "file:frontend/.env.local" (Test-Path $frontendEnvPath) "frontend local env"
  Add-Check "file:evm/.env" (Test-Path $evmEnvPath) "EVM deploy/verify env"

  $rootEnv = Read-DotEnv $rootEnvPath
  Test-EnvValue $rootEnv "MOCK_VALIDATOR_SHARE_ADDRESS"
  Test-EnvValue $rootEnv "CANTON_APP_PROVIDER_PARTY"
  Test-EnvValue $rootEnv "CANTON_DELEGATOR_PARTY"
  Test-EnvValue $rootEnv "FEATURED_APP_RIGHT_CID"
  Test-EnvValue $rootEnv "NEXT_PUBLIC_MOCK_LOOP_PARTY_ID"

  $damlDar = Join-Path $Root "daml\CantonStake\.daml\dars\splice-api-featured-app-v1.dar"
  $appDar = Join-Path $Root "daml\CantonStake\.daml\dist\cantonstake-0.0.1.dar"
  Add-Check "daml:splice DAR" (Test-Path $damlDar) ".daml/dars/splice-api-featured-app-v1.dar"
  Add-Check "daml:app DAR" (Test-Path $appDar) ".daml/dist/cantonstake-0.0.1.dar"

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($docker) {
    $composeVersion = docker compose version 2>$null
    Add-Check "docker:compose" ($LASTEXITCODE -eq 0) ($composeVersion -join " ")
    $containers = docker ps --format "{{.Names}}" 2>$null
    Add-Check "docker:running" ($LASTEXITCODE -eq 0) ($(if ($containers) { ($containers -join ", ") } else { "docker reachable, no running containers" }))
  }

  $daml = Get-Command daml -ErrorAction SilentlyContinue
  if ($daml) {
    $damlVersion = daml version 2>$null
    Add-Check "daml:version" ($LASTEXITCODE -eq 0) ($damlVersion -join " ")
  }

  if ($RunBuilds) {
    npm --prefix backend run build
    Add-Check "build:backend" ($LASTEXITCODE -eq 0) "npm --prefix backend run build"

    npm --prefix frontend run build
    Add-Check "build:frontend" ($LASTEXITCODE -eq 0) "npm --prefix frontend run build"

    npm --prefix evm run compile
    Add-Check "build:evm" ($LASTEXITCODE -eq 0) "npm --prefix evm run compile"

    if ($daml) {
      Push-Location (Join-Path $Root "daml\CantonStake")
      daml build
      $damlOk = $LASTEXITCODE -eq 0
      Pop-Location
      Add-Check "build:daml" $damlOk "daml build"
    }
  }

  $Checks | Format-Table -AutoSize

  $failed = @($Checks | Where-Object { $_.Status -ne "ok" })
  if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Preflight found $($failed.Count) missing item(s)." -ForegroundColor Yellow
    exit 1
  }

  Write-Host ""
  Write-Host "Preflight passed." -ForegroundColor Green
}
finally {
  Pop-Location
}

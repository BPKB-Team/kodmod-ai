param(
    [ValidateSet('up', 'build', 'backup', 'migrate', 'api', 'infra', 'qdrant', 'down', 'status', 'logs', 'admin', 'demo-users', 'monitoring-up', 'monitoring-down', 'monitoring-status', 'monitoring-logs')]
    [string]$Action = 'up',
    [string]$CentreRoot = 'F:\Docker_Centre\kodmod'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) {
    $dockerExe = $dockerCommand.Source
} else {
    $dockerDirectory = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
    $dockerExe = Join-Path $dockerDirectory 'docker.exe'
    $env:Path = "$dockerDirectory;$env:Path"
}
if (-not (Test-Path -LiteralPath $dockerExe)) {
    throw 'Docker CLI not found. Start Docker Desktop first.'
}

$composeArgs = @('compose', '--project-directory', $sourceRoot)
$centreEnv = [System.IO.Path]::Combine($CentreRoot, '.env')
$centreOverride = [System.IO.Path]::Combine($CentreRoot, 'compose.override.yaml')
$usesCentre = $false
if ((Test-Path -LiteralPath $centreEnv) -and (Test-Path -LiteralPath $centreOverride)) {
    $entry = Get-Content -LiteralPath $centreEnv |
        Where-Object { $_ -match '^KODMOD_SOURCE_ROOT=' } | Select-Object -First 1
    if (-not $entry) { throw 'Docker Centre has no KODMOD_SOURCE_ROOT.' }
    $configuredRoot = ($entry -split '=', 2)[1].Trim().Trim('"').Trim("'")
    $resolvedRoot = (Resolve-Path -LiteralPath $configuredRoot).Path
    if ($resolvedRoot -ne $sourceRoot) {
        throw "Docker Centre points to a different checkout: $resolvedRoot"
    }
    $composeArgs += @('--project-name', 'kodmod-centre', '--env-file', $centreEnv,
        '--file', (Join-Path $sourceRoot 'docker-compose.yml'), '--file', $centreOverride)
    $usesCentre = $true
} else {
    $composeArgs += @('--file', (Join-Path $sourceRoot 'docker-compose.yml'))
}

$monitoringProfileActions = @('up', 'api', 'down', 'status', 'logs', 'monitoring-up', 'monitoring-down', 'monitoring-status', 'monitoring-logs')
if ($Action -in $monitoringProfileActions) {
    $composeArgs += @('--profile', 'monitoring')
    if ($IsLinux) { $composeArgs += @('--profile', 'monitoring-linux') }
}

# The optional Qdrant profile is included for application lifecycle/status
# commands when selected, and for down so a full stack stop also stops Qdrant.
# PostgreSQL remains available as the retrieval fallback.
$runtimeEnv = if ($usesCentre) { $centreEnv } else { Join-Path $sourceRoot '.env' }
$vectorBackend = if ($env:VECTOR_BACKEND) { $env:VECTOR_BACKEND } else { 'pgvector' }
if (-not $env:VECTOR_BACKEND -and (Test-Path -LiteralPath $runtimeEnv)) {
    $backendEntry = Get-Content -LiteralPath $runtimeEnv |
        Where-Object { $_ -match '^VECTOR_BACKEND=' } | Select-Object -First 1
    if ($backendEntry) { $vectorBackend = ($backendEntry -split '=', 2)[1].Trim().Trim('"').Trim("'") }
}
if (($vectorBackend -eq 'qdrant' -and $Action -in @('up', 'api', 'status', 'logs')) -or $Action -eq 'down') {
    $composeArgs += @('--profile', 'qdrant')
}

if ($usesCentre -and $Action -in @('up', 'monitoring-up')) {
    $lines = @(Get-Content -LiteralPath $centreEnv)
    $dataRoot = [System.IO.Path]::GetFullPath((Join-Path $CentreRoot 'data\monitoring')).Replace('\', '/')
    $hasDataRoot = $false
    $hasPassword = $false
    $passwordReady = $false
    $generatedNewPassword = $false
    $updated = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        if ($line -match '^MONITORING_DATA_ROOT=(.*)$') {
            $hasDataRoot = $true
            if ([string]::IsNullOrWhiteSpace($matches[1])) { $updated.Add("MONITORING_DATA_ROOT=$dataRoot") }
            else { $updated.Add($line) }
        } elseif ($line -match '^GRAFANA_ADMIN_PASSWORD=(.*)$') {
            $hasPassword = $true
            if ([string]::IsNullOrWhiteSpace($matches[1])) { $updated.Add('GRAFANA_ADMIN_PASSWORD=') }
            else { $updated.Add($line); $passwordReady = $true }
        } else {
            $updated.Add($line)
        }
    }
    if (-not $hasDataRoot) { $updated.Add("MONITORING_DATA_ROOT=$dataRoot") }
    if (-not $hasPassword -or -not $passwordReady) {
        $secretBytes = [byte[]]::new(32)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
        $generatedPassword = [Convert]::ToHexString($secretBytes).ToLowerInvariant()
        $generatedNewPassword = $true
        if ($hasPassword) {
            for ($index = $updated.Count - 1; $index -ge 0; $index--) {
                if ($updated[$index] -match '^GRAFANA_ADMIN_PASSWORD=') {
                    $updated[$index] = "GRAFANA_ADMIN_PASSWORD=$generatedPassword"
                    break
                }
            }
        } else {
            $updated.Add("GRAFANA_ADMIN_PASSWORD=$generatedPassword")
        }
        $passwordReady = $true
    }
    [System.IO.File]::WriteAllText($centreEnv, (($updated -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
    New-Item -ItemType Directory -Force -Path (Join-Path $CentreRoot 'data\monitoring\prometheus') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $CentreRoot 'data\monitoring\grafana') | Out-Null
    Write-Host "Monitoring data directory: $(Join-Path $CentreRoot 'data\monitoring')"
    if ($generatedNewPassword) { Write-Host 'Generated a private Grafana admin password in the Docker Centre .env.' }
}

function Save-DatabaseBackup {
    param([switch]$Required)
    $taskContainer = & $dockerExe @composeArgs ps --all -q postgres
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the PostgreSQL service.' }
    if (-not $taskContainer) {
        if ($Required) { throw 'Start PostgreSQL before creating a backup.' }
        return # Fresh installation: no existing database to back up.
    }
    $taskContainer = $taskContainer.Trim()
    $taskBackupDirectory = if (Test-Path -LiteralPath $centreOverride) {
        Join-Path $CentreRoot 'backups'
    } else {
        Join-Path $sourceRoot '.runtime/backups'
    }
    New-Item -ItemType Directory -Force -Path $taskBackupDirectory | Out-Null
    $taskName = 'kodmod-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.dump'
    $taskRemotePath = '/tmp/' + $taskName
    $taskDestination = Join-Path $taskBackupDirectory $taskName
    & $dockerExe @composeArgs exec -T postgres pg_dump -U kodmod -d kodmod -Fc -f $taskRemotePath
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed. Runtime update cancelled.' }
    $taskArchive = & $dockerExe @composeArgs exec -T postgres pg_restore --list $taskRemotePath
    if ($LASTEXITCODE -ne 0 -or $taskArchive.Count -lt 10) { throw 'Database backup archive is invalid.' }
    & $dockerExe cp "${taskContainer}:$taskRemotePath" $taskDestination
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database backup to persistent storage.' }
    $taskFile = Get-Item -LiteralPath $taskDestination
    if ($taskFile.Length -eq 0) { throw 'Database backup is empty.' }
    $taskManifest = @{
        created_at = [DateTimeOffset]::UtcNow.ToString('o')
        filename = $taskName
        bytes = $taskFile.Length
        sha256 = (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant()
        archive_entries = $taskArchive.Count
        source_checkout = $sourceRoot
    }
    $taskManifest | ConvertTo-Json | Set-Content -LiteralPath ($taskDestination + '.json') -Encoding utf8
    Write-Host "Verified PostgreSQL backup: $taskDestination"
}

# Preserve the existing database before Compose's migration dependency runs.
if ($Action -in @('up', 'api', 'migrate')) {
    & $dockerExe @composeArgs up -d --wait --wait-timeout 90 postgres
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is unavailable. Runtime update cancelled.' }
    Save-DatabaseBackup -Required
} elseif ($Action -eq 'backup') {
    Save-DatabaseBackup -Required
}

switch ($Action) {
    'backup' { exit 0 }
    'up' { $composeArgs += @('up', '-d', '--build', '--wait', '--wait-timeout', '180') }
    'api' { $composeArgs += @('up', '-d', '--build', '--wait', '--wait-timeout', '180') }
    'build' { $composeArgs += @('build', 'ai-engine', 'web') }
    'infra' { $composeArgs += @('up', '-d', 'postgres', 'redis') }
    'migrate' { $composeArgs += @('run', '--rm', '--build', 'migrate') }
    'qdrant' { $composeArgs += @('--profile', 'qdrant', 'up', '-d', 'qdrant') }
    'down' { $composeArgs += @('down') }
    'status' { $composeArgs += @('ps', '--all') }
    'logs' { $composeArgs += @('logs', '--tail', '100', '--follow') }
    'monitoring-up' {
        $monitoringServices = @('prometheus', 'grafana', 'cadvisor')
        if ($IsLinux) { $monitoringServices += 'node-exporter' }
        $composeArgs += @('up', '-d', '--wait', '--wait-timeout', '90') + $monitoringServices
    }
    'monitoring-down' {
        $monitoringServices = @('prometheus', 'grafana', 'cadvisor')
        if ($IsLinux) { $monitoringServices += 'node-exporter' }
        $composeArgs += @('stop') + $monitoringServices
    }
    'monitoring-status' {
        $monitoringServices = @('prometheus', 'grafana', 'cadvisor')
        if ($IsLinux) { $monitoringServices += 'node-exporter' }
        $composeArgs += @('ps', '--all') + $monitoringServices
    }
    'monitoring-logs' {
        $monitoringServices = @('prometheus', 'grafana', 'cadvisor')
        if ($IsLinux) { $monitoringServices += 'node-exporter' }
        $composeArgs += @('logs', '--tail', '100', '--follow') + $monitoringServices
    }
    'admin' { $composeArgs += @('exec', 'ai-engine', 'python', '-m', 'scripts.create_admin', '--username', 'admin') }
    'demo-users' {
        & $dockerExe @composeArgs build ai-engine
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $runContainer = "kodmod-demo-users-$PID"
        $composeArgs += @('run', '--rm', '--no-deps', '--name', $runContainer, 'ai-engine', 'python', '-m', 'scripts.seed_demo_users')
    }
}
& $dockerExe @composeArgs
exit $LASTEXITCODE

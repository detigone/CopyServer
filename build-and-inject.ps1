# CopyServer — безопасная сборка и установка пользовательского плагина Vencord
# Запуск: .\build-and-inject.ps1
# Dev-сборка: .\build-and-inject.ps1 -Dev
# Откат последней установки: .\build-and-inject.ps1 -Rollback
#
# Пути можно переопределить параметрами или переменными окружения:
#   VENCORD_SOURCE — каталог исходников Vencord

[CmdletBinding()]
param(
    [string]$PluginSource = (Join-Path $PSScriptRoot "serverCloner\index.tsx"),
    [string]$VencordSource = $env:VENCORD_SOURCE,
    [string]$InstallDir = (Join-Path $env:APPDATA "Vencord\dist"),
    [string]$DiscordPath,
    [switch]$Dev,
    [switch]$NoLaunch,
    [switch]$Rollback
)

$ErrorActionPreference = "Stop"

function Write-Step([int]$Number, [int]$Total, [string]$Message) {
    Write-Host ""
    Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Test-VencordSource([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (
        (Test-Path -LiteralPath (Join-Path $Path "package.json")) -and
        (Test-Path -LiteralPath (Join-Path $Path "scripts\build\build.mjs"))
    )
}

function Resolve-VencordSource([string]$RequestedPath) {
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $resolved = [System.IO.Path]::GetFullPath($RequestedPath)
        if (-not (Test-VencordSource $resolved)) {
            throw "Каталог '$resolved' не похож на исходники Vencord. Проверь package.json и scripts\build\build.mjs."
        }
        return $resolved
    }

    $candidates = @()
    if ($env:VENCORD_SOURCE) { $candidates += $env:VENCORD_SOURCE }
    $candidates += @(
        (Join-Path $PSScriptRoot "..\VencordSource"),
        (Join-Path $HOME "VencordSource"),
        (Join-Path $HOME "Vencord"),
        (Join-Path $HOME "source\Vencord"),
        (Join-Path $HOME "Projects\Vencord")
    )

    $found = @()
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-VencordSource $candidate) {
            $found += [System.IO.Path]::GetFullPath($candidate)
        }
    }

    if ($found.Count -eq 1) {
        return $found[0]
    }

    if ($found.Count -gt 1) {
        Write-Host "Найдено несколько каталогов Vencord:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $found.Count; $i++) {
            Write-Host "  $($i + 1). $($found[$i])"
        }
        $selection = Read-Host "Выбери номер или введи другой путь"
        $number = 0
        if ([int]::TryParse($selection, [ref]$number) -and $number -ge 1 -and $number -le $found.Count) {
            return $found[$number - 1]
        }
        if (-not [string]::IsNullOrWhiteSpace($selection) -and (Test-VencordSource $selection)) {
            return [System.IO.Path]::GetFullPath($selection)
        }
        throw "Не выбран корректный каталог исходников Vencord."
    }

    Write-Host "Исходники Vencord автоматически не найдены." -ForegroundColor Yellow
    Write-Host "Укажи папку с package.json и scripts\build\build.mjs."
    $manualPath = Read-Host "Путь к исходникам Vencord"
    if ([string]::IsNullOrWhiteSpace($manualPath) -or -not (Test-VencordSource $manualPath)) {
        throw "Не удалось подтвердить каталог исходников Vencord."
    }
    return [System.IO.Path]::GetFullPath($manualPath)
}

function Stop-DiscordGracefully {
    $running = @(Get-Process -Name "Discord" -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        Write-Host "Discord уже закрыт." -ForegroundColor DarkGray
        return
    }

    Write-Host "Закрываю Discord штатно. Сохрани несохранённую работу перед продолжением." -ForegroundColor Yellow
    foreach ($process in $running) {
        try {
            if ($process.MainWindowHandle -ne 0) {
                [void]$process.CloseMainWindow()
            }
        } catch {
            # Повторная проверка ниже покажет, остался ли процесс активным.
        }
    }

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 500
        $remaining = @(Get-Process -Name "Discord" -ErrorAction SilentlyContinue)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    if ($remaining.Count -gt 0) {
        throw "Discord не закрылся штатно. Закрой его вручную и запусти установщик повторно. Принудительное завершение процесса отключено."
    }
}

function Start-DiscordClient([string]$ExplicitPath) {
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $fullPath = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Discord.exe не найден: $fullPath"
        }
        Start-Process -FilePath $fullPath
        return
    }

    $discordRoot = Join-Path $env:LOCALAPPDATA "Discord"
    $latest = Get-ChildItem -LiteralPath $discordRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^app-\d+(\.\d+)*$' } |
        Sort-Object -Property {
            try { [version]($_.Name.Substring(4)) } catch { [version]"0.0" }
        } -Descending |
        Select-Object -First 1

    if ($latest -and (Test-Path -LiteralPath (Join-Path $latest.FullName "Discord.exe"))) {
        Start-Process -FilePath (Join-Path $latest.FullName "Discord.exe")
        return
    }

    $updater = Join-Path $discordRoot "Update.exe"
    if (Test-Path -LiteralPath $updater) {
        Start-Process -FilePath $updater -ArgumentList "--processStart Discord.exe"
        return
    }

    throw "Не удалось найти Discord. Укажи путь к Discord.exe через -DiscordPath."
}

function Get-ManagedFiles {
    return @("patcher.js", "preload.js", "renderer.js")
}

function Restore-Backup([string]$TargetDirectory) {
    $backupRoot = Join-Path (Split-Path $TargetDirectory -Parent) "backups"
    $latestBackup = Get-ChildItem -LiteralPath $backupRoot -Directory -Filter "CopyServer-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latestBackup) {
        throw "Резервные копии CopyServer не найдены в '$backupRoot'."
    }

    $manifestPath = Join-Path $latestBackup.FullName "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "В резервной копии отсутствует manifest.json: $($latestBackup.FullName)"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([System.IO.Path]::GetFullPath($manifest.TargetDir) -ne [System.IO.Path]::GetFullPath($TargetDirectory)) {
        throw "Эта резервная копия относится к другому каталогу: $($manifest.TargetDir)"
    }

    Stop-DiscordGracefully
    New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null

    foreach ($name in $manifest.DeployedFiles) {
        $destination = Join-Path $TargetDirectory $name
        $savedFile = Join-Path $latestBackup.FullName $name
        if ($manifest.OriginalFiles -contains $name) {
            if (-not (Test-Path -LiteralPath $savedFile)) {
                throw "Файл резервной копии повреждён или отсутствует: $savedFile"
            }
            Copy-Item -LiteralPath $savedFile -Destination $destination -Force
        } elseif (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination -Force
        }
    }

    Write-Host "Откат выполнен из: $($latestBackup.FullName)" -ForegroundColor Green
}

try {
    $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)

    if ($Rollback) {
        Write-Step 1 2 "Восстанавливаю предыдущую версию Vencord..."
        Restore-Backup $InstallDir
        if (-not $NoLaunch) {
            Write-Step 2 2 "Запускаю Discord..."
            Start-DiscordClient $DiscordPath
        }
        Write-Host ""
        Write-Host "Откат завершён." -ForegroundColor Green
        exit 0
    }

    $PluginSource = [System.IO.Path]::GetFullPath($PluginSource)
    if (-not (Test-Path -LiteralPath $PluginSource -PathType Leaf)) {
        throw "Не найден исходный плагин: $PluginSource"
    }
    $pluginText = Get-Content -LiteralPath $PluginSource -Raw
    if ($pluginText -notmatch 'definePlugin' -or $pluginText -notmatch 'ServerCloner|CopyServer') {
        throw "Файл плагина не прошёл базовую проверку. Ожидался Vencord-плагин с definePlugin и именем ServerCloner/CopyServer."
    }

    $VencordSource = Resolve-VencordSource $VencordSource
    $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
    $requiredInstalledFiles = @("patcher.js", "preload.js", "renderer.js")
    $installDirIsValid = (Test-Path -LiteralPath $InstallDir -PathType Container)
    if ($installDirIsValid) {
        foreach ($requiredInstalledFile in $requiredInstalledFiles) {
            if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $requiredInstalledFile) -PathType Leaf)) {
                $installDirIsValid = $false
                break
            }
        }
    }

    if (-not $installDirIsValid) {
        Write-Host "Каталог Vencord dist не найден по стандартному пути: $InstallDir" -ForegroundColor Yellow
        Write-Host "Нужна именно папка, в которой лежат patcher.js, preload.js и renderer.js."
        $manualInstallDir = Read-Host "Путь к папке Vencord dist"
        if ([string]::IsNullOrWhiteSpace($manualInstallDir)) {
            throw "Путь к установленному Vencord не указан."
        }
        $InstallDir = [System.IO.Path]::GetFullPath($manualInstallDir)
        if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) {
            throw "Каталог не существует: $InstallDir"
        }
        foreach ($requiredInstalledFile in $requiredInstalledFiles) {
            if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $requiredInstalledFile) -PathType Leaf)) {
                throw "В выбранном каталоге отсутствует $requiredInstalledFile. Выбери папку Vencord dist."
            }
        }
    }

    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        throw "Node.js не найден в PATH."
    }
    if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
        throw "pnpm не найден в PATH. Установи зависимости Vencord согласно официальной инструкции."
    }

    $pluginDirectory = Join-Path $VencordSource "src\userplugins\serverCloner"
    $vencordPlugin = Join-Path $pluginDirectory "index.tsx"
    $buildDirectory = Join-Path $VencordSource "dist"
    $backupStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"

    Write-Host "CopyServer Vencord Injector" -ForegroundColor Green
    Write-Host "Исходники: $VencordSource" -ForegroundColor DarkGray
    Write-Host "Установка: $InstallDir" -ForegroundColor DarkGray
    Write-Host "Режим: $(if ($Dev) { 'Development (--dev)' } else { 'Production' })" -ForegroundColor DarkGray

    Write-Step 1 5 "Подготавливаю плагин..."
    New-Item -ItemType Directory -Force -Path $pluginDirectory | Out-Null

    if (Test-Path -LiteralPath $vencordPlugin) {
        $pluginBackupRoot = Join-Path $VencordSource ".copyserver-backups\serverCloner"
        New-Item -ItemType Directory -Force -Path $pluginBackupRoot | Out-Null
        Copy-Item -LiteralPath $vencordPlugin -Destination (Join-Path $pluginBackupRoot "index-$backupStamp.tsx") -Force
        Write-Host "Предыдущий файл плагина сохранён в .copyserver-backups." -ForegroundColor DarkGray
    }

    Copy-Item -LiteralPath $PluginSource -Destination $vencordPlugin -Force

    Write-Step 2 5 "Собираю Vencord..."
    Push-Location $VencordSource
    try {
        if ($Dev) {
            & pnpm build --dev
        } else {
            & pnpm build
        }
        $buildExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($buildExitCode -ne 0) {
        throw "Сборка Vencord завершилась с кодом $buildExitCode."
    }

    $managedFiles = Get-ManagedFiles
    foreach ($name in $managedFiles) {
        $builtFile = Join-Path $buildDirectory $name
        if (-not (Test-Path -LiteralPath $builtFile -PathType Leaf)) {
            throw "Сборка не создала обязательный файл: $builtFile"
        }
        if ((Get-Item -LiteralPath $builtFile).Length -le 0) {
            throw "Сборка создала пустой файл: $builtFile"
        }
    }

    $builtRenderer = Get-Content -LiteralPath (Join-Path $buildDirectory "renderer.js") -Raw
    if ($builtRenderer -notmatch 'ServerCloner|CopyServer') {
        throw "Проверка сборки не обнаружила CopyServer/ServerCloner в renderer.js. Установка отменена."
    }
    Write-Host "Сборка проверена: patcher.js, preload.js, renderer.js; маркер плагина найден." -ForegroundColor Green

    Write-Step 3 5 "Подготавливаю резервную копию..."
    $backupRoot = Join-Path (Split-Path $InstallDir -Parent) "backups"
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $backupDirectory = Join-Path $backupRoot "CopyServer-$backupStamp"
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null

    $originalFiles = @()
    foreach ($name in $managedFiles) {
        $installedFile = Join-Path $InstallDir $name
        if (Test-Path -LiteralPath $installedFile -PathType Leaf) {
            Copy-Item -LiteralPath $installedFile -Destination (Join-Path $backupDirectory $name) -Force
            $originalFiles += $name
        }
    }

    $manifest = @{
        CreatedAt = (Get-Date).ToString("o")
        TargetDir = $InstallDir
        VencordSource = $VencordSource
        BuildMode = $(if ($Dev) { "dev" } else { "production" })
        DeployedFiles = $managedFiles
        OriginalFiles = $originalFiles
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupDirectory "manifest.json") -Encoding UTF8

    Write-Step 4 5 "Устанавливаю сборку..."
    Stop-DiscordGracefully

    $stageDirectory = Join-Path $InstallDir (".copyserver-stage-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $stageDirectory | Out-Null
    try {
        foreach ($name in $managedFiles) {
            Copy-Item -LiteralPath (Join-Path $buildDirectory $name) -Destination (Join-Path $stageDirectory $name) -Force
        }

        foreach ($name in $managedFiles) {
            Move-Item -LiteralPath (Join-Path $stageDirectory $name) -Destination (Join-Path $InstallDir $name) -Force
        }

        $installedRenderer = Get-Content -LiteralPath (Join-Path $InstallDir "renderer.js") -Raw
        if ($installedRenderer -notmatch 'ServerCloner|CopyServer') {
            throw "После установки маркер плагина не найден в renderer.js."
        }
    } catch {
        Write-Host "Ошибка установки. Выполняю автоматический откат..." -ForegroundColor Yellow
        foreach ($name in $managedFiles) {
            $destination = Join-Path $InstallDir $name
            $savedFile = Join-Path $backupDirectory $name
            if ($originalFiles -contains $name -and (Test-Path -LiteralPath $savedFile)) {
                Copy-Item -LiteralPath $savedFile -Destination $destination -Force
            } elseif (Test-Path -LiteralPath $destination) {
                Remove-Item -LiteralPath $destination -Force
            }
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $stageDirectory) {
            Remove-Item -LiteralPath $stageDirectory -Recurse -Force
        }
    }

    Write-Host "Установка проверена. Резервная копия: $backupDirectory" -ForegroundColor Green

    if (-not $NoLaunch) {
        Write-Step 5 5 "Запускаю Discord..."
        Start-DiscordClient $DiscordPath
    } else {
        Write-Step 5 5 "Запуск Discord пропущен (-NoLaunch)."
    }

    Write-Host ""
    Write-Host "Готово! CopyServer собран и установлен в Vencord." -ForegroundColor Green
    Write-Host "Настройки: Discord -> Настройки -> Vencord -> Plugins -> ServerCloner." -ForegroundColor DarkGray
    Write-Host "Откат: .\build-and-inject.ps1 -Rollback" -ForegroundColor DarkGray
} catch {
    Write-Host ""
    Write-Host "ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

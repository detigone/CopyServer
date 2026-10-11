# ServerCloner — автоматическая сборка Vencord с плагином и инжект в Discord
# Запуск: powershell -ExecutionPolicy Bypass -File "F:\CopyServer\build-and-inject.ps1"

$ErrorActionPreference = "Stop"

$pluginSrc  = "F:\CopyServer\serverCloner\index.tsx"
$vc         = "C:\Users\Serega-Dima-Christi\VencordSource"
$vcPlugin   = "$vc\src\userplugins\serverCloner\index.tsx"
$vencordDist = "$env:APPDATA\Vencord\dist"
$bak        = "$env:APPDATA\Vencord\dist.backup-preServerCloner"

function Step($n, $msg) {
    Write-Host ""
    Write-Host "[$n/5] $msg" -ForegroundColor Cyan
}

if (-not (Test-Path $pluginSrc)) { throw "Не найден плагин: $pluginSrc" }
if (-not (Test-Path $vc))        { throw "Не найдена папка исходников Vencord: $vc" }

Step 1 "Копирую плагин в исходники Vencord..."
New-Item -ItemType Directory -Force -Path (Split-Path $vcPlugin) | Out-Null
Copy-Item $pluginSrc $vcPlugin -Force

Step 2 "Собираю Vencord..."
Push-Location $vc
node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Сборка Vencord упала с ошибкой (код $LASTEXITCODE). Если это первая сборка — сначала выполни 'pnpm install' в $vc"
}
Pop-Location

if (-not (Test-Path "$vc\dist\renderer.js")) { throw "Сборка не создала dist\renderer.js" }

Step 3 "Останавливаю Discord (если запущен)..."
Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Step 4 "Заменяю dist Vencord (с бэкапом при первой замене)..."
if (-not (Test-Path $bak)) {
    Copy-Item $vencordDist $bak -Recurse
    Write-Host "     Бэкап сохранён: $bak" -ForegroundColor DarkGray
}
Copy-Item "$vc\dist\patcher.js*"  -Destination $vencordDist -Force
Copy-Item "$vc\dist\preload.js*"  -Destination $vencordDist -Force
Copy-Item "$vc\dist\renderer.*"   -Destination $vencordDist -Force

$renderer = [System.IO.File]::ReadAllText("$vencordDist\renderer.js")
if (-not $renderer.Contains("ServerCloner")) {
    throw "Плагин не найден в renderer.js — что-то пошло не так"
}
Write-Host "     Плагин ServerCloner в билде: OK" -ForegroundColor Green

Step 5 "Запускаю Discord..."
$latest = Get-ChildItem "$env:LOCALAPPDATA\Discord" -Directory |
    Where-Object { $_.Name -like "app-*" } |
    Sort-Object -Property { [version]($_.Name -replace "app-", "") } -Descending |
    Select-Object -First 1

if ($latest) {
    Start-Process "$($latest.FullName)\Discord.exe"
} else {
    Start-Process "$env:LOCALAPPDATA\Discord\Update.exe" -ArgumentList "--processStart", "Discord.exe"
}

Write-Host ""
Write-Host "Готово! Discord запускается с плагином ServerCloner." -ForegroundColor Green
Write-Host "Настройки: Настройки Discord -> Vencord -> Plugins -> ServerCloner -> шестерёнка" -ForegroundColor DarkGray

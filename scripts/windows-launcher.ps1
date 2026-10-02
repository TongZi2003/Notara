param(
    [ValidateSet('Start', 'Stop', 'Shortcuts')][string]$Action = 'Start',
    [string]$RuntimeRoot = '',
    [string]$ControllerConfig = '',
    [int]$Port = 0,
    [string]$ShortcutDirectory = '',
    [switch]$NoBrowser,
    [switch]$NoUI
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = Split-Path -Parent $PSScriptRoot
$userDirectory = [Environment]::GetFolderPath('UserProfile')
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $userDirectory '.notara\vault-runtime' }
if (-not $ControllerConfig) { $ControllerConfig = Join-Path $userDirectory '.notara\remote-access\config.json' }
$scriptPath = Join-Path $PSScriptRoot 'windows-launcher.ps1'

function Show-Result([string]$Message, [bool]$Failed = $false) {
    Write-Host $Message
    if (-not $NoUI) {
        Add-Type -AssemblyName System.Windows.Forms
        $icon = if ($Failed) { [Windows.Forms.MessageBoxIcon]::Error } else { [Windows.Forms.MessageBoxIcon]::Information }
        [void][Windows.Forms.MessageBox]::Show($Message, 'Notara', [Windows.Forms.MessageBoxButtons]::OK, $icon)
    }
}

function Quote-Argument([string]$Value) {
    if ($Value -match '["\r\n]') { throw '路径不能包含引号或换行。' }
    # Avoid a final backslash escaping the closing quote in Windows argv parsing.
    return '"' + [regex]::Replace($Value, '(\\+)$', '$1$1') + '"'
}

function New-DesktopShortcuts {
    if (-not $ShortcutDirectory) { $ShortcutDirectory = [Environment]::GetFolderPath('DesktopDirectory') }
    if (-not $ShortcutDirectory) { throw '无法定位桌面，请指定 -ShortcutDirectory。' }
    $destination = [IO.Path]::GetFullPath($ShortcutDirectory)
    [void][IO.Directory]::CreateDirectory($destination)
    $shell = New-Object -ComObject WScript.Shell
    $powershellPath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    $entries = @(@{ Name = '启动 Notara'; Action = 'Start' }, @{ Name = '关闭 Notara'; Action = 'Stop' })
    try {
        # Validate both existing names before changing either shortcut.
        foreach ($entry in $entries) {
            $path = Join-Path $destination ($entry.Name + '.lnk')
            if (Test-Path -LiteralPath $path) {
                $old = $shell.CreateShortcut($path)
                if ($old.WorkingDirectory -ne $projectRoot -or -not $old.Arguments.Contains((Quote-Argument $scriptPath))) {
                    throw "同名快捷方式属于另一个安装目录，请先移走它：$path"
                }
            }
        }
        foreach ($entry in $entries) {
            $link = $shell.CreateShortcut((Join-Path $destination ($entry.Name + '.lnk')))
            $link.TargetPath = $powershellPath
            $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote-Argument $scriptPath) +
                ' -Action ' + $entry.Action + ' -RuntimeRoot ' + (Quote-Argument $RuntimeRoot) + ' -ControllerConfig ' + (Quote-Argument $ControllerConfig)
            if ($entry.Action -eq 'Start' -and $Port -gt 0) { $link.Arguments += ' -Port ' + $Port }
            $link.WorkingDirectory = $projectRoot
            $link.Description = $entry.Name + ' (' + $projectRoot + ')'
            $link.WindowStyle = 7
            $link.Save()
        }
        Show-Result "已创建「启动 Notara」和「关闭 Notara」两个桌面快捷方式。`n移动或重新解压项目后，请在新目录重新创建快捷方式。"
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

try {
    $RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
    $ControllerConfig = [IO.Path]::GetFullPath($ControllerConfig)
    if ($Action -eq 'Shortcuts') { New-DesktopShortcuts; exit 0 }
    if ($Action -eq 'Start' -and ((Test-Path -LiteralPath (Join-Path $projectRoot '.notara-install.lock')) -or (Test-Path -LiteralPath (Join-Path $projectRoot '.notara-install-journal.json')))) {
        throw '此目录正在安装或有未恢复的安装记录。请先完成安装，再启动 Notara。'
    }
    if ($Port -lt 0 -or $Port -gt 65535) { throw '端口必须在 1 到 65535 之间，留空则使用默认端口。' }
    $nodePath = $null
    $npmEntry = $null
    foreach ($candidate in @(Get-Command node.exe -CommandType Application -All -ErrorAction Stop)) {
        $nodeOutput = @(& $candidate.Source -p 'process.versions.node')
        $nodeCode = $LASTEXITCODE
        $nodeVersion = [string]($nodeOutput | Select-Object -First 1)
        $candidateNpm = Join-Path (Split-Path -Parent $candidate.Source) 'node_modules\npm\bin\npm-cli.js'
        if ($nodeCode -eq 0 -and $nodeVersion -match '^\d+\.' -and [int]($nodeVersion.Split('.')[0]) -ge 24 -and (Test-Path -LiteralPath $candidateNpm)) {
            $nodePath = $candidate.Source; $npmEntry = $candidateNpm; break
        }
    }
    if (-not $nodePath) { throw '需要 Node.js 24 或更新版本及 npm。请运行「安装 Notara.cmd」或修复 Node.js 安装。' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\tsx\package.json'))) {
        throw '依赖尚未安装。请在项目目录的 Git Bash 执行 npm ci --no-audit --no-fund，完成后再双击启动。'
    }
    $tsxPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'node_modules\tsx\package.json') -Raw | ConvertFrom-Json
    $tsxBin = if ($tsxPackage.bin -is [string]) { $tsxPackage.bin } else { $tsxPackage.bin.tsx }
    if (-not $tsxBin) { throw 'tsx 依赖不完整，请重新安装。' }
    $tsxEntry = Join-Path (Join-Path $projectRoot 'node_modules\tsx') $tsxBin
    $desktopAction = if ($Action -eq 'Start') { 'start' } else { 'stop' }
    $arguments = @($tsxEntry, (Join-Path $projectRoot 'scripts\desktop-vault.ts'), $desktopAction, '--root', $RuntimeRoot, '--config', $ControllerConfig)
    if ($Action -eq 'Start' -and $Port -gt 0) { $arguments += @('--port', [string]$Port) }
    if ($NoBrowser) { $arguments += '--no-open' }
    Push-Location -LiteralPath $projectRoot
    $previousNpmExecPath = $env:npm_execpath
    $previousProcessPath = $env:Path
    try {
        # Avoid npm-generated .cmd shims, which misparse ampersands in paths.
        $env:npm_execpath = $npmEntry
        $env:Path = (Split-Path -Parent $nodePath) + ';' + $env:Path
        $ErrorActionPreference = 'Continue'
        $output = & $nodePath @arguments 2>&1
        $resultCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        Write-Host $text
        if ($resultCode -ne 0) { throw $text }
        if ($Action -eq 'Stop') { Show-Result 'Notara 已关闭，课堂和资料已保留。' }
    } finally { $ErrorActionPreference = 'Stop'; $env:npm_execpath = $previousNpmExecPath; $env:Path = $previousProcessPath; Pop-Location }
} catch {
    Show-Result ("操作未完成：`n" + $_.Exception.Message) $true
    exit 1
}

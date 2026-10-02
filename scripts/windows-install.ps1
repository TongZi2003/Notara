[CmdletBinding()]
param(
    [switch]$NoUI,
    [switch]$NoShortcuts,
    [switch]$SkipLatest,
    [switch]$CheckOnly,
    [switch]$PlainProgress
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$markerPath = Join-Path $projectRoot 'notara-files.json'
$installerPath = Join-Path $PSScriptRoot 'install-vault.ts'
$launcherPath = Join-Path $PSScriptRoot 'windows-launcher.ps1'
$script:InstallDisplay = $null
$script:InstallPercent = 0
$script:InstallLog = $null
$script:InstallLogPath = $null
$script:NativeInvocationError = $null
$displayPath = Join-Path $PSScriptRoot 'installer-character-progress.ps1'
if (Test-Path -LiteralPath $displayPath -PathType Leaf) {
    try {
        . $displayPath
        $script:InstallDisplay = New-NotaraInstallDisplay -Plain:($PlainProgress -or $CheckOnly)
    } catch { $script:InstallDisplay = $null }
}

function Write-InstallLog([string]$Line) {
    if ($script:InstallLog) {
        try { $script:InstallLog.WriteLine($Line) } catch {
            try { $script:InstallLog.Dispose() } catch { }
            $script:InstallLog = $null
        }
    }
}

function Show-InstallProgress([int]$Percent, [string]$Stage) {
    $script:InstallPercent = [Math]::Max($script:InstallPercent, $Percent)
    Write-InstallLog "$Percent% $Stage"
    if ($script:InstallDisplay) {
        Show-NotaraInstallCharacterProgress -Display $script:InstallDisplay -Percent $script:InstallPercent -Stage $Stage -Animate
        return
    }
    $filled = [int][Math]::Floor($Percent / 5)
    Write-Host ('[' + ('#' * $filled) + ('-' * (20 - $filled)) + "] $Percent% $Stage")
}

function Write-InstallOutput($Value, [switch]$AllowProgress) {
    if ($Value -is [Management.Automation.ErrorRecord] -and $Value.FullyQualifiedErrorId -notlike 'NativeCommandError*') {
        # Command-not-found/access failures must not reuse a previous process's
        # successful exit code when PS 5.1 is temporarily in Continue mode.
        $script:NativeInvocationError = [string]$Value
    }
    $line = ([string]$Value -replace '\x1b\[[0-?]*[ -/]*[@-~]', '').TrimEnd("`r")
    Write-InstallLog $line
    # Only the Node installer emits phase checkpoints. WinGet/npm output must
    # never declare the outer installer complete before shortcuts are ready.
    if ($AllowProgress -and $line -match '^\[[#-]{20}\] (\d{1,2})% (.+)$') {
        $percent = [int]$Matches[1]
        $stage = $Matches[2]
        if ($percent -ge 20 -and $percent -le 95) {
            Show-InstallProgress $percent $stage
            return
        }
    }
    if (-not $script:InstallDisplay -or -not $script:InstallDisplay.Interactive) { Write-Host $line -ForegroundColor Cyan }
}

function Show-InstallerMessage([string]$Message, [bool]$Failed = $false) {
    if (-not $script:InstallDisplay -or -not $script:InstallDisplay.Interactive -or $Failed) { Write-Host $Message -ForegroundColor Cyan }
    if (-not $NoUI) {
        Add-Type -AssemblyName System.Windows.Forms
        $icon = if ($Failed) { [Windows.Forms.MessageBoxIcon]::Error } else { [Windows.Forms.MessageBoxIcon]::Information }
        [void][Windows.Forms.MessageBox]::Show($Message, 'Notara 安装程序', [Windows.Forms.MessageBoxButtons]::OK, $icon)
    }
}

function Refresh-ProcessPath {
    $oldPath = $env:Path
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $ordered = New-Object 'System.Collections.Generic.List[string]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)

    foreach ($source in @($machinePath, $userPath, $oldPath)) {
        foreach ($part in ([string]$source -split ';')) {
            $entry = [Environment]::ExpandEnvironmentVariables($part.Trim().Trim('"'))
            if (-not $entry) { continue }
            if ($seen.Add($entry)) { $ordered.Add($entry) }
        }
    }
    $env:Path = $ordered -join ';'
}

function Get-PathExecutables([string]$Name) {
    $results = New-Object 'System.Collections.Generic.List[string]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($part in ($env:Path -split ';')) {
        $directory = [Environment]::ExpandEnvironmentVariables($part.Trim().Trim('"'))
        if (-not $directory) { continue }
        try { $candidate = [IO.Path]::GetFullPath((Join-Path $directory $Name)) } catch { continue }
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and $seen.Add($candidate)) {
            $results.Add($candidate)
        }
    }
    return @($results.ToArray())
}

function Get-NodeRuntime {
    $firstVersion = $null
    foreach ($nodePath in (Get-PathExecutables 'node.exe')) {
        $versionOutput = @(& $nodePath -p 'process.versions.node' 2>$null)
        $nodeExitCode = $LASTEXITCODE
        $versionText = if ($versionOutput.Count -gt 0) { $versionOutput[0] } else { $null }
        if ($nodeExitCode -ne 0 -or -not $versionText) { continue }
        $versionText = ([string]$versionText).Trim()
        if (-not $firstVersion) { $firstVersion = $versionText }
        if ($versionText -notmatch '^\d+\.\d+\.\d+(?:[-+].*)?$') { continue }
        if ([int]($versionText.Split('.')[0]) -lt 24) { continue }

        $npmEntry = Join-Path (Split-Path -Parent $nodePath) 'node_modules\npm\bin\npm-cli.js'
        if (-not (Test-Path -LiteralPath $npmEntry -PathType Leaf)) { continue }
        $npmVersionOutput = @(& $nodePath $npmEntry --version 2>$null)
        $npmExitCode = $LASTEXITCODE
        $npmVersionText = if ($npmVersionOutput.Count -gt 0) { $npmVersionOutput[0] } else { $null }
        if ($npmExitCode -ne 0 -or -not $npmVersionText -or ([string]$npmVersionText).Trim() -notmatch '^\d+\.\d+\.\d+') { continue }

        return [pscustomobject]@{
            Path       = $nodePath
            Version    = $versionText
            NpmEntry   = $npmEntry
            NpmVersion = ([string]$npmVersionText).Trim()
        }
    }
    return [pscustomobject]@{ Path = $null; Version = $firstVersion; NpmEntry = $null; NpmVersion = $null }
}

function Test-GitBash([string]$BashPath) {
    if (-not $BashPath -or $BashPath -match '(?i)\\(System32|WindowsApps)\\') { return $null }
    if (-not (Test-Path -LiteralPath $BashPath -PathType Leaf)) { return $null }
    try {
        $signatureOutput = @(& $BashPath --noprofile --norc -c 'uname -s' 2>$null)
        $bashExitCode = $LASTEXITCODE
        $signature = if ($signatureOutput.Count -gt 0) { $signatureOutput[0] } else { $null }
        if ($bashExitCode -eq 0 -and ([string]$signature).Trim() -match '^(MINGW|MSYS)') { return $BashPath }
    } catch { }
    return $null
}

function Get-GitBashRuntime {
    $explicit = [Environment]::GetEnvironmentVariable('NOTARA_GIT_BASH', 'Process')
    if ($explicit) {
        try { $explicit = [IO.Path]::GetFullPath($explicit) } catch { }
        $bash = Test-GitBash $explicit
        if ($bash) { return [pscustomobject]@{ Path = $bash; GitPath = $null; Reason = $null; ExplicitInvalid = $false } }
        return [pscustomobject]@{
            Path = $null; GitPath = $null
            Reason = "NOTARA_GIT_BASH 当前指向不可用的 Git Bash：$explicit。请修正变量，使其指向 Git for Windows 安装目录中的 bin\bash.exe。"
            ExplicitInvalid = $true
        }
    }

    $roots = New-Object 'System.Collections.Generic.List[string]'
    $gitPathFound = $null
    foreach ($gitPath in (Get-PathExecutables 'git.exe')) {
        $gitVersionOutput = @(& $gitPath --version 2>$null)
        $gitExitCode = $LASTEXITCODE
        $gitVersion = if ($gitVersionOutput.Count -gt 0) { $gitVersionOutput[0] } else { $null }
        if ($gitExitCode -ne 0 -or ([string]$gitVersion) -notmatch '^git version ') { continue }
        $gitPathFound = $gitPath
        $execPathOutput = @(& $gitPath --exec-path 2>$null)
        $execExitCode = $LASTEXITCODE
        $execPath = if ($execPathOutput.Count -gt 0) { $execPathOutput[0] } else { $null }
        if ($execExitCode -eq 0 -and $execPath) {
            $root = [string]$execPath
            for ($i = 0; $i -lt 3; $i++) { $root = Split-Path -Parent $root }
            if ($root) { $roots.Add($root) }
        }
        break
    }

    foreach ($key in @(
        'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\GitForWindows',
        'Registry::HKEY_CURRENT_USER\SOFTWARE\GitForWindows',
        'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\GitForWindows'
    )) {
        try {
            $value = (Get-ItemProperty -LiteralPath $key -Name InstallPath -ErrorAction Stop).InstallPath
            if ($value) { $roots.Add([string]$value) }
        } catch { }
    }

    $knownLocations = @(
        [pscustomobject]@{ Base = $env:ProgramFiles; Suffix = 'Git' },
        [pscustomobject]@{ Base = ${env:ProgramFiles(x86)}; Suffix = 'Git' },
        [pscustomobject]@{ Base = $env:LOCALAPPDATA; Suffix = 'Programs\Git' },
        [pscustomobject]@{ Base = $env:USERPROFILE; Suffix = 'scoop\apps\git\current' }
    )
    foreach ($location in $knownLocations) {
        if ($location.Base) { $roots.Add((Join-Path $location.Base $location.Suffix)) }
    }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($root in $roots) {
        $bashPath = Join-Path $root 'bin\bash.exe'
        if (-not $seen.Add($bashPath)) { continue }
        $bash = Test-GitBash $bashPath
        if ($bash) { return [pscustomobject]@{ Path = $bash; GitPath = $gitPathFound; Reason = $null; ExplicitInvalid = $false } }
    }

    return [pscustomobject]@{
        Path = $null; GitPath = $gitPathFound
        Reason = '没有找到有效的 Git for Windows 和 Git Bash。'
        ExplicitInvalid = $false
    }
}

function Get-DependencyState {
    return [pscustomobject]@{
        Node = Get-NodeRuntime
        Git = Get-GitBashRuntime
    }
}

function Set-SelectedRuntimeEnvironment([string]$NodePath, [string]$GitBashPath) {
    $nodeDirectory = Split-Path -Parent $NodePath
    $ordered = New-Object 'System.Collections.Generic.List[string]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [void]$seen.Add($nodeDirectory)
    $ordered.Add($nodeDirectory)
    foreach ($part in ($env:Path -split ';')) {
        $entry = [Environment]::ExpandEnvironmentVariables($part.Trim().Trim('"'))
        if ($entry -and $seen.Add($entry)) { $ordered.Add($entry) }
    }
    $env:Path = $ordered -join ';'
    $env:NOTARA_GIT_BASH = $GitBashPath
}

function Get-WinGetPath {
    $command = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Install-WinGetPackage([string]$WinGetPath, [string]$PackageId, [string]$DisplayName) {
    Write-InstallOutput "正在通过 WinGet 安装 $DisplayName。安装器可能会请求 UAC 确认。"
    $arguments = @('install', '--id', $PackageId, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--silent', '--disable-interactivity')
    $savedPreference = $ErrorActionPreference
    $script:NativeInvocationError = $null
    try {
        # PS 5.1 represents redirected native stderr as ErrorRecord objects.
        # Warnings are not process failure; the actual exit code decides that.
        $ErrorActionPreference = 'Continue'
        & $WinGetPath @arguments 2>&1 | ForEach-Object { Write-InstallOutput $_ }
        $installExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($script:NativeInvocationError) { throw $script:NativeInvocationError }
    if ($installExitCode -ne 0) {
        throw "WinGet 安装 $DisplayName 失败或被取消（退出码 $installExitCode）。请确认安装器/UAC 提示后重试。"
    }
}

function Invoke-NotaraInstall {
    Show-InstallProgress 0 '检查安装目录（进度表示完成的安装阶段）'
    if (Test-Path -LiteralPath (Join-Path $projectRoot '.git')) {
        throw "检测到 Git 源码 checkout。此快捷安装入口只支持 Notara Release 资产 ZIP。源码 checkout 请使用旧方式：在 Git Bash 中执行 npm ci --no-audit --no-fund，然后 npm run vault。"
    }
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "当前目录缺少 notara-files.json。请下载并解压 GitHub Releases 中的 Notara Release ZIP 资产；GitHub 的 Source code ZIP 不支持此快捷安装入口。"
    }
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "发布包缺少 scripts\install-vault.ts，请重新下载 Notara Release ZIP。"
    }

    if (-not $CheckOnly) {
        try {
            $logRoot = Join-Path $projectRoot '.runtime\install-logs'
            [void][IO.Directory]::CreateDirectory($logRoot)
            $script:InstallLogPath = Join-Path $logRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N') + '.log')
            $script:InstallLog = New-Object IO.StreamWriter($script:InstallLogPath, $false, (New-Object Text.UTF8Encoding($false)))
            $script:InstallLog.AutoFlush = $true
        } catch { $script:InstallLogPath = $null }
    }

    Show-InstallProgress 5 '检查 Node.js、npm 和 Git Bash'
    Refresh-ProcessPath
    $state = Get-DependencyState
    if ($state.Git.ExplicitInvalid) { throw $state.Git.Reason }

    if ($CheckOnly) {
        if ($state.Node.Path) { Write-Host "Node.js $($state.Node.Version) 和 npm $($state.Node.NpmVersion)：可用。" }
        else {
            $detail = if ($state.Node.Version) { "找到 Node.js $($state.Node.Version)，但需要 Node.js 24+ 且 npm 可用。" } else { '没有找到可用的 Node.js 24+ 和 npm。' }
            Write-Host $detail
        }
        if ($state.Git.Path) { Write-Host "Git Bash：$($state.Git.Path)" }
        else { Write-Host $state.Git.Reason }
        if (-not $state.Node.Path -or -not $state.Git.Path) { throw 'CheckOnly 检查未通过；未安装任何依赖。' }
        return
    }

    if (-not $state.Node.Path -or -not $state.Git.Path) {
        $wingetPath = Get-WinGetPath
        if (-not $wingetPath) {
            throw "系统找不到 WinGet。请从 Microsoft Store 安装或更新 App Installer：https://apps.microsoft.com/detail/9NBLGGH4NNS1 ，然后重新运行。官方说明：https://learn.microsoft.com/windows/package-manager/winget/#install-winget 。若无法使用 WinGet，可手动安装 Node.js：https://nodejs.org/en/download 和 Git for Windows：https://gitforwindows.org/ 。"
        }

        if (-not $state.Node.Path) {
            Show-InstallProgress 10 '安装 Node.js；请等待系统安装器完成'
            Install-WinGetPackage $wingetPath 'OpenJS.NodeJS.LTS' 'Node.js LTS 24+'
            Refresh-ProcessPath
            $state.Node = Get-NodeRuntime
            if (-not $state.Node.Path) { throw 'Node.js 安装器已结束，但 PATH 中仍没有可用的 Node.js 24+ 与 npm。请关闭安装窗口、重新运行本入口，或检查 Node.js 安装。' }
        }

        if (-not $state.Git.Path) {
            Show-InstallProgress 15 '安装 Git for Windows；请等待系统安装器完成'
            Install-WinGetPackage $wingetPath 'Git.Git' 'Git for Windows（含 Git Bash）'
            Refresh-ProcessPath
            $state.Git = Get-GitBashRuntime
            if (-not $state.Git.Path) { throw "Git 安装器已结束，但仍没有检测到有效的 Git Bash。$($state.Git.Reason) 请重新运行本入口或手动安装 Git for Windows：https://gitforwindows.org/ 。" }
        }
    }

    Write-InstallOutput "已检测到 Node.js $($state.Node.Version)、npm $($state.Node.NpmVersion) 和 Git Bash。"
    Push-Location -LiteralPath $projectRoot
    $previousPath = $env:Path
    $previousNpmExecPath = $env:npm_execpath
    $previousGitBash = $env:NOTARA_GIT_BASH
    try {
        Set-SelectedRuntimeEnvironment $state.Node.Path $state.Git.Path
        $env:npm_execpath = $state.Node.NpmEntry
        $arguments = @($installerPath, '--npm-entry', $state.Node.NpmEntry)
        if ($SkipLatest) { $arguments += '--skip-latest' }
        $savedPreference = $ErrorActionPreference
        $script:NativeInvocationError = $null
        try {
            $ErrorActionPreference = 'Continue'
            & $state.Node.Path @arguments 2>&1 | ForEach-Object { Write-InstallOutput $_ -AllowProgress }
            $installExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($script:NativeInvocationError) { throw $script:NativeInvocationError }
        if ($installExitCode -ne 0) { throw "Notara 安装失败（退出码 $installExitCode）。请保留上方错误信息后重试。" }
    } finally {
        $env:Path = $previousPath
        $env:npm_execpath = $previousNpmExecPath
        $env:NOTARA_GIT_BASH = $previousGitBash
        Pop-Location
    }

    if (-not $NoShortcuts) {
        Show-InstallProgress 95 '创建桌面启动与关闭快捷方式'
        $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcutArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcherPath, '-Action', 'Shortcuts')
        $shortcutArguments += '-NoUI'
        $savedPreference = $ErrorActionPreference
        $script:NativeInvocationError = $null
        try {
            $ErrorActionPreference = 'Continue'
            & $powerShellExe @shortcutArguments 2>&1 | ForEach-Object { Write-InstallOutput $_ }
            $shortcutExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($script:NativeInvocationError) { throw $script:NativeInvocationError }
        if ($shortcutExitCode -ne 0) { throw "Notara 已安装，但创建桌面快捷方式失败（退出码 $shortcutExitCode）。仍可双击解压目录中的「start-notara.cmd」和「stop-notara.cmd」。" }
    }

    Show-InstallProgress 100 '安装完成'
    $success = "Notara 安装完成。以后双击解压目录中的「start-notara.cmd」启动，双击「stop-notara.cmd」停止。"
    if ($NoShortcuts) { $success += "`n桌面快捷方式未创建；可随时双击「create-notara-shortcuts.cmd」。" }
    Show-InstallerMessage $success
}

try {
    Invoke-NotaraInstall
    exit 0
} catch {
    $message = "安装未完成：`n$($_.Exception.Message)"
    Write-InstallLog $message
    if ($script:InstallDisplay) {
        Show-NotaraInstallCharacterProgress -Display $script:InstallDisplay -Percent ([Math]::Min(99, $script:InstallPercent)) -Stage '请查看下方错误后重试' -Failed
        if ($script:InstallDisplay.Interactive -and $script:InstallLogPath) {
            try { Get-Content -LiteralPath $script:InstallLogPath -Encoding UTF8 -Tail 20 | ForEach-Object { Write-Host $_ -ForegroundColor Cyan } } catch { }
        }
    }
    if ($script:InstallLogPath) { $message += "`n完整安装日志：$script:InstallLogPath" }
    [Console]::Error.WriteLine($message)
    if (-not $NoUI) {
        try { Show-InstallerMessage $message $true } catch { }
    }
    exit 1
} finally {
    if ($script:InstallLog) { $script:InstallLog.Dispose() }
}

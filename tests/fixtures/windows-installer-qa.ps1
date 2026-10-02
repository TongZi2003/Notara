[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TestRoot,
    [Parameter(Mandatory = $true)]
    [string]$NodeExecutable
)

# All executable side effects are replaced in an isolated copy of the installer.

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw "Expected Windows PowerShell 5.1, got $($PSVersionTable.PSVersion)." }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaRoot = [IO.Path]::GetFullPath($TestRoot)
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $qaRoot.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot must be a mkdtemp child of the operating system temp directory.' }
if ([IO.Directory]::GetFileSystemEntries($qaRoot).Length -ne 0) { throw 'TestRoot must be empty before running the installer fixture.' }
$fixtureRoot = Join-Path $qaRoot 'Release fixture & spaces'
$scriptsRoot = Join-Path $fixtureRoot 'scripts'
$reportsRoot = Join-Path $qaRoot 'reports'
$actualCheckRoot = Join-Path $qaRoot 'Actual Node CheckOnly & spaces'
$actualScriptsRoot = Join-Path $actualCheckRoot 'scripts'
$actualNodeDirectory = Split-Path -Parent $NodeExecutable
$actualNpmEntry = Join-Path $actualNodeDirectory 'node_modules\npm\bin\npm-cli.js'
$actualCheckBashPath = Join-Path $qaRoot 'mock git\bin\bash.exe'
$sourcePath = Join-Path $repoRoot 'scripts\windows-install.ps1'
$fixtureScript = Join-Path $scriptsRoot 'windows-install.ps1'
$actualCheckScript = Join-Path $actualScriptsRoot 'windows-install.ps1'
$mockNodePath = Join-Path $qaRoot 'mock runtime\node.exe'
$mockNpmEntry = Join-Path $qaRoot 'mock runtime\node_modules\npm\bin\npm-cli.js'
$mockGitPath = Join-Path $qaRoot 'mock git\cmd\git.exe'
$mockGitBashPath = Join-Path $qaRoot 'mock git\bin\bash.exe'
$powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

New-Item -ItemType Directory -Force -Path $scriptsRoot, $reportsRoot, $actualScriptsRoot | Out-Null
foreach ($target in @($fixtureRoot, $actualCheckRoot)) {
    $artRoot = Join-Path $target 'resources\installer'
    [void][IO.Directory]::CreateDirectory($artRoot)
    [IO.File]::Copy((Join-Path $repoRoot 'scripts\installer-character-progress.ps1'), (Join-Path $target 'scripts\installer-character-progress.ps1'))
    [IO.File]::Copy((Join-Path $repoRoot 'resources\installer\mascot-outline.json'), (Join-Path $artRoot 'mascot-outline.json'))
}
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'notara-files.json'), '{}')
[IO.File]::WriteAllText((Join-Path $scriptsRoot 'install-vault.ts'), '// CheckOnly/installer sentinel; mock harness must never execute it.')
$nativeProbePath = Join-Path $qaRoot 'native-output.cjs'
[IO.File]::WriteAllText($nativeProbePath, 'console.log("[#######-------------] 35% synthetic npm phase"); console.error("synthetic native warning"); process.exit(Number(process.argv[2]));')

$productSource = [IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8).Replace("`r`n", "`n")
$source = $productSource
$replacements = @(
    @{ From = '& $WinGetPath @arguments'; To = 'Invoke-MockWinGet $WinGetPath $arguments' },
    @{ From = '& $state.Node.Path @arguments'; To = 'Invoke-MockInstaller $state.Node.Path $arguments' },
    @{ From = '& $powerShellExe @shortcutArguments'; To = 'Invoke-MockShortcuts $powerShellExe $shortcutArguments' }
)
foreach ($replacement in $replacements) {
    if (-not $source.Contains($replacement.From)) { throw "Mock hook not found; refusing to run: $($replacement.From)" }
    $source = $source.Replace($replacement.From, $replacement.To)
}

$mainMarker = "try {`n    Invoke-NotaraInstall`n"
$mainIndex = $source.LastIndexOf($mainMarker, [StringComparison]::Ordinal)
if ($mainIndex -lt 0) { throw 'Could not locate installer entry point; refusing to run.' }

$mockHooks = @'
$script:MockCase = $env:NOTARA_INSTALLER_MOCK_CASE
$script:MockWingetLookups = 0
$script:MockPackages = New-Object 'System.Collections.Generic.List[object]'
$script:MockInstallerCalls = 0
$script:MockInstallerPath = $null
$script:MockInstallerArgs = @()
$script:MockNpmExecPath = $null
$script:MockShortcutCalls = 0

function New-MockNode([bool]$Valid) {
    if ($Valid) {
        return [pscustomobject]@{
            Path = $env:NOTARA_INSTALLER_MOCK_NODE; Version = '24.99.0'
            NpmEntry = $env:NOTARA_INSTALLER_MOCK_NPM; NpmVersion = '99.0.0'
        }
    }
    return [pscustomobject]@{ Path = $null; Version = $null; NpmEntry = $null; NpmVersion = $null }
}

function New-MockGit([bool]$Valid) {
    if ($Valid) { return [pscustomobject]@{ Path = $env:NOTARA_INSTALLER_MOCK_BASH; GitPath = $env:NOTARA_INSTALLER_MOCK_GIT; Reason = $null; ExplicitInvalid = $false } }
    return [pscustomobject]@{ Path = $null; GitPath = $null; Reason = 'Mock Git Bash missing.'; ExplicitInvalid = $false }
}

function Get-NodeRuntime { return New-MockNode $true }
function Get-GitBashRuntime { return New-MockGit $true }

function Get-DependencyState {
    $node = New-MockNode $true
    $git = New-MockGit $true
    if ($script:MockCase -in @('missing-node', 'no-winget', 'winget-failure', 'checkonly-missing')) { $node = New-MockNode $false }
    if ($script:MockCase -in @('missing-git', 'checkonly-missing')) { $git = New-MockGit $false }
    return [pscustomobject]@{ Node = $node; Git = $git }
}

function Get-WinGetPath {
    $script:MockWingetLookups++
    if ($script:MockCase -eq 'no-winget') { return $null }
    if ($script:MockCase -in @('missing-node', 'missing-git', 'winget-failure')) { return 'MOCK-WINGET-PATH' }
    throw "FAIL-CLOSED: unexpected WinGet lookup in case '$script:MockCase'."
}

function Invoke-MockWinGet([string]$Path, [string[]]$Arguments) {
    $script:MockPackages.Add([pscustomobject]@{ Path = $Path; Arguments = @($Arguments) })
    if ($Path -ne 'MOCK-WINGET-PATH') { throw 'FAIL-CLOSED: unexpected WinGet executable path.' }
    if ($script:MockCase -eq 'winget-failure') { $global:LASTEXITCODE = 23; return }
    if ($script:MockCase -in @('missing-node', 'missing-git')) { $global:LASTEXITCODE = 0; return }
    throw "FAIL-CLOSED: unexpected package installation in case '$script:MockCase'."
}

function Invoke-MockInstaller([string]$Path, [string[]]$Arguments) {
    $script:MockInstallerCalls++
    $script:MockInstallerPath = $Path
    $script:MockInstallerArgs = @($Arguments)
    $script:MockNpmExecPath = $env:npm_execpath
    if ($script:MockCase -in @('native-warning', 'native-failure')) {
        # Real harmless child exercises PS5.1 native stderr merging and exit
        # code propagation. This cannot install packages or touch user data.
        $code = if ($script:MockCase -eq 'native-failure') { 7 } else { 0 }
        & $env:NOTARA_INSTALLER_REAL_NODE $env:NOTARA_INSTALLER_NATIVE_PROBE $code
        $global:LASTEXITCODE = $LASTEXITCODE
        return
    }
    if ($script:MockCase -eq 'missing-executable') {
        & (Join-Path $env:NOTARA_INSTALLER_MOCK_NODE 'missing.exe')
        return
    }
    $global:LASTEXITCODE = 0
}

function Invoke-MockShortcuts([string]$Path, [string[]]$Arguments) {
    $script:MockShortcutCalls++
    if ($script:MockCase -eq 'shortcut-failure') { $global:LASTEXITCODE = 11; return }
    $global:LASTEXITCODE = 0
}

function Write-MockReport([int]$ExitCode) {
    $report = [ordered]@{
        Case = $script:MockCase
        ExitCode = $ExitCode
        WingetLookups = $script:MockWingetLookups
        Packages = @($script:MockPackages.ToArray())
        InstallerCalls = $script:MockInstallerCalls
        InstallerPath = $script:MockInstallerPath
        InstallerArgs = @($script:MockInstallerArgs)
        NpmExecPath = $script:MockNpmExecPath
        ShortcutCalls = $script:MockShortcutCalls
    }
    [IO.File]::WriteAllText($env:NOTARA_INSTALLER_MOCK_REPORT, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}
'@
$source = $source.Insert($mainIndex, $mockHooks + "`n")
$source = $source.Replace("    Invoke-NotaraInstall`n    exit 0", "    Invoke-NotaraInstall`n    Write-MockReport 0`n    exit 0")
$source = $source.Replace("    exit 1`n}", "    Write-MockReport 1`n    exit 1`n}")
[IO.File]::WriteAllText($fixtureScript, $source, (New-Object Text.UTF8Encoding($true)))

$actualCheckSource = $productSource
$actualCheckHooks = @'
function Refresh-ProcessPath { }
function Get-GitBashRuntime {
    return [pscustomobject]@{ Path = $env:NOTARA_INSTALLER_CHECK_GIT_BASH; GitPath = $null; Reason = $null; ExplicitInvalid = $false }
}
function Get-WinGetPath { throw 'FAIL-CLOSED: WinGet lookup is forbidden in CheckOnly.' }
function Install-WinGetPackage { throw 'FAIL-CLOSED: WinGet execution is forbidden in CheckOnly.' }
'@
$actualMainIndex = $actualCheckSource.LastIndexOf($mainMarker, [StringComparison]::Ordinal)
if ($actualMainIndex -lt 0) { throw 'Could not locate actual Node CheckOnly entry point; refusing to run.' }
$actualCheckSource = $actualCheckSource.Insert($actualMainIndex, $actualCheckHooks + "`n")
foreach ($unsafe in @(
    @{ From = '& $WinGetPath @arguments'; To = "throw 'FAIL-CLOSED: WinGet process invocation.'" },
    @{ From = '& $state.Node.Path @arguments'; To = "throw 'FAIL-CLOSED: Notara installer process invocation.'" },
    @{ From = '& $powerShellExe @shortcutArguments'; To = "throw 'FAIL-CLOSED: shortcut launcher invocation.'" }
)) {
    if (-not $actualCheckSource.Contains($unsafe.From)) { throw "Actual Node CheckOnly guard not found: $($unsafe.From)" }
    $actualCheckSource = $actualCheckSource.Replace($unsafe.From, $unsafe.To)
}
[IO.File]::WriteAllText($actualCheckScript, $actualCheckSource, (New-Object Text.UTF8Encoding($true)))
[IO.File]::WriteAllText((Join-Path $actualCheckRoot 'notara-files.json'), '{}')
[IO.File]::WriteAllText((Join-Path $actualScriptsRoot 'install-vault.ts'), '// CheckOnly sentinel; must never run.')

function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -ne $Expected) { throw "${Label}: expected [$Expected], got [$Actual]." }
}

function Assert-PackageArguments($Report, [string]$ExpectedId) {
    $packages = @($Report.Packages)
    Assert-Equal $packages.Count 1 'package call count'
    Assert-Equal $packages[0].Arguments[0] 'install' 'winget verb'
    Assert-Equal $packages[0].Arguments[1] '--id' 'winget id flag'
    Assert-Equal $packages[0].Arguments[2] $ExpectedId 'winget package id'
    foreach ($flag in @('--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--silent')) {
        if ($packages[0].Arguments -notcontains $flag) { throw "WinGet argument missing: $flag" }
    }
    foreach ($forbidden in @('--force', '--ignore-security-hash', '--allow-reboot')) {
        if ($packages[0].Arguments -contains $forbidden) { throw "Unexpected WinGet argument: $forbidden" }
    }
}

function Quote-QAArgument([string]$Value) {
    if ($Value.Contains('"')) { throw 'Unexpected quote in a QA argument.' }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

function Invoke-QAChild([string]$ScriptPath, [string[]]$InstallerArgs, [hashtable]$Environment) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powerShellExe
    $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $InstallerArgs
    $startInfo.Arguments = (($args | ForEach-Object { Quote-QAArgument ([string]$_) }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $startInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    foreach ($key in $Environment.Keys) {
        if ($null -eq $Environment[$key]) { [void]$startInfo.EnvironmentVariables.Remove($key) }
        else { $startInfo.EnvironmentVariables[$key] = [string]$Environment[$key] }
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdout + "`n" + $stderr }
}

if (-not [IO.Path]::IsPathRooted($NodeExecutable) -or -not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) { throw 'NodeExecutable must be the current test runner node.exe.' }
if (-not (Test-Path -LiteralPath $actualNpmEntry -PathType Leaf)) { throw 'Current test runner Node has no adjacent npm-cli.js; cannot assert the usable-Node CheckOnly contract.' }

$cases = @(
    @{ Name = 'missing-node'; Args = @('-NoUI', '-NoShortcuts'); Exit = 0; Lookups = 1; PackageIds = @('OpenJS.NodeJS.LTS'); Installer = 1; Shortcuts = 0 },
    @{ Name = 'missing-git'; Args = @('-NoUI', '-NoShortcuts'); Exit = 0; Lookups = 1; PackageIds = @('Git.Git'); Installer = 1; Shortcuts = 0 },
    @{ Name = 'no-winget'; Args = @('-NoUI'); Exit = 1; Lookups = 1; PackageIds = @(); Installer = 0; Shortcuts = 0 },
    @{ Name = 'winget-failure'; Args = @('-NoUI'); Exit = 1; Lookups = 1; PackageIds = @('OpenJS.NodeJS.LTS'); Installer = 0; Shortcuts = 0 },
    @{ Name = 'no-update'; Args = @('-NoUI', '-NoShortcuts', '-SkipLatest'); Exit = 0; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 0 },
    @{ Name = 'checkonly-valid'; Args = @('-NoUI', '-CheckOnly'); Exit = 0; Lookups = 0; PackageIds = @(); Installer = 0; Shortcuts = 0 },
    @{ Name = 'checkonly-missing'; Args = @('-NoUI', '-CheckOnly'); Exit = 1; Lookups = 0; PackageIds = @(); Installer = 0; Shortcuts = 0 },
    @{ Name = 'no-shortcuts-success'; Args = @('-NoUI', '-NoShortcuts'); Exit = 0; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 0 }
    @{ Name = 'native-warning'; Args = @('-NoUI', '-NoShortcuts'); Exit = 0; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 0 }
    @{ Name = 'native-failure'; Args = @('-NoUI', '-NoShortcuts'); Exit = 1; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 0 }
    @{ Name = 'missing-executable'; Args = @('-NoUI', '-NoShortcuts'); Exit = 1; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 0 }
    @{ Name = 'shortcut-failure'; Args = @('-NoUI'); Exit = 1; Lookups = 0; PackageIds = @(); Installer = 1; Shortcuts = 1 }
)

$results = New-Object 'System.Collections.Generic.List[object]'
foreach ($case in $cases) {
    $reportPath = Join-Path $reportsRoot ($case.Name + '.json')
    [IO.File]::WriteAllText($reportPath, 'pending')
    $childEnvironment = @{
        NOTARA_INSTALLER_MOCK_CASE = $case.Name
        NOTARA_INSTALLER_MOCK_REPORT = $reportPath
        NOTARA_INSTALLER_MOCK_NODE = $mockNodePath
        NOTARA_INSTALLER_MOCK_NPM = $mockNpmEntry
        NOTARA_INSTALLER_MOCK_GIT = $mockGitPath
        NOTARA_INSTALLER_MOCK_BASH = $mockGitBashPath
        NOTARA_INSTALLER_REAL_NODE = $NodeExecutable
        NOTARA_INSTALLER_NATIVE_PROBE = $nativeProbePath
    }
    $child = Invoke-QAChild $fixtureScript $case.Args $childEnvironment
    $processExitCode = $child.ExitCode
    $output = $child.Output
    if ($output -notmatch '\[[#-]{20}\] \d+%') { throw "$($case.Name): installer progress bar is missing." }
    if ($case.Exit -ne 0 -and $output -match '\] 100%') { throw "$($case.Name): failed installation reported 100%." }
    if ($case.Exit -eq 0 -and $case.Installer -gt 0 -and $output -notmatch '\] 100%') { throw "$($case.Name): completed installation did not finish its progress bar.`n$output" }
    if ($case.Name -in @('native-warning', 'native-failure')) {
        if ($output -notmatch '\] 35%' -or $output -notmatch 'synthetic native warning') { throw 'Native phase or stderr was swallowed.' }
        $logs = @(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot '.runtime\install-logs') -Filter '*.log' | Sort-Object LastWriteTimeUtc -Descending)
        $nativeLog = [IO.File]::ReadAllText($logs[0].FullName, [Text.Encoding]::UTF8)
        if ($nativeLog -notmatch 'synthetic native warning') { throw 'Native stderr missing from install log.' }
        if ($case.Name -eq 'native-failure' -and $output -notmatch '退出码 7') { throw 'Native failure exit code was not preserved.' }
    }

    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    Assert-Equal $processExitCode $case.Exit "$($case.Name) process exit"
    Assert-Equal $report.ExitCode $case.Exit "$($case.Name) reported exit"
    Assert-Equal $report.WingetLookups $case.Lookups "$($case.Name) WinGet lookups"
    Assert-Equal $report.InstallerCalls $case.Installer "$($case.Name) installer calls"
    Assert-Equal $report.ShortcutCalls $case.Shortcuts "$($case.Name) shortcut calls"
    $actualIds = @($report.Packages | ForEach-Object { $_.Arguments[2] })
    if ($actualIds.Count -ne $case.PackageIds.Count) { throw "$($case.Name): expected package ids [$($case.PackageIds -join ',')], got [$($actualIds -join ',')]." }
    for ($i = 0; $i -lt $actualIds.Count; $i++) { Assert-Equal $actualIds[$i] $case.PackageIds[$i] "$($case.Name) package id $i" }
    if ($case.PackageIds.Count -gt 0) { Assert-PackageArguments $report $case.PackageIds[0] }
    if ($case.Name -eq 'no-winget' -and $output -notmatch 'apps\.microsoft\.com/detail/9NBLGGH4NNS1') { throw 'No-WinGet path omitted the official App Installer address.' }
    if ($case.Name -eq 'no-update') {
        $installerArgs = @($report.InstallerArgs)
        Assert-Equal $installerArgs[1] '--npm-entry' 'npm entry flag'
        if (-not [IO.Path]::IsPathRooted($installerArgs[2])) { throw 'npm-cli.js path was not absolute.' }
        if ($installerArgs -notcontains '--skip-latest') { throw 'SkipLatest was not forwarded.' }
        Assert-Equal $report.NpmExecPath $installerArgs[2] 'npm_execpath'
    }
    $results.Add([pscustomobject]@{ Case = $case.Name; ExitCode = $processExitCode; WingetLookups = $report.WingetLookups; PackageIds = $actualIds; InstallerCalls = $report.InstallerCalls; ShortcutCalls = $report.ShortcutCalls })
    Write-Output "PASS $($case.Name) (exit $processExitCode; winget lookups $($report.WingetLookups); installer calls $($report.InstallerCalls); shortcuts $($report.ShortcutCalls))"
}

$actualNodeEnvironment = @{
    PATH = $actualNodeDirectory + ';' + $env:PATH
    NOTARA_INSTALLER_CHECK_GIT_BASH = $actualCheckBashPath
}
$nodeCheck = Invoke-QAChild $actualCheckScript @('-NoUI', '-CheckOnly') $actualNodeEnvironment
$nodeOutput = $nodeCheck.Output.Trim()
$nodeDetected = $nodeOutput -match 'Node\.js \d+\.\d+\.\d+ 和 npm \d+\.\d+\.\d+：可用'
if ($nodeCheck.ExitCode -ne 0 -or -not $nodeDetected) {
    throw "CheckOnly misclassified the current test runner Node/npm, or called a fail-closed operation. Exit $($nodeCheck.ExitCode):`n$nodeOutput"
}
Write-Output "PASS actual-node-checkonly (exit $($nodeCheck.ExitCode); $($Matches[0]))"

$resultsPath = Join-Path $qaRoot 'results.json'
$summary = [ordered]@{
    MockCases = @($results.ToArray())
    ActualNodeCheck = [pscustomobject]@{ ExitCode = $nodeCheck.ExitCode; DetectedUsableNode = $nodeDetected; Output = $nodeOutput }
}
[IO.File]::WriteAllText($resultsPath, ($summary | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Write-Output "Installer QA passed: $($cases.Count) mock cases plus actual Node CheckOnly. Evidence: $resultsPath"

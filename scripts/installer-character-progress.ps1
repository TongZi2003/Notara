# Reusable display only. This file never installs software or launches a child process.

function Read-NotaraInstallOutline {
    param([string]$Path = (Join-Path $PSScriptRoot '..\resources\installer\mascot-outline.json'))
    $data = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($data.format -ne 1 -or @($data.variants).Count -ne 4) { throw 'Invalid installer outline data.' }
    foreach ($variant in $data.variants) {
        if ($variant.columns -lt 20 -or $variant.columns -gt 80 -or @($variant.lines).Count -gt 42) { throw 'Invalid installer outline size.' }
        foreach ($line in $variant.lines) {
            if ($line.Length -gt $variant.columns -or $line -match '[^ \u2800-\u28ff]') { throw 'Invalid installer outline characters.' }
        }
    }
    return @($data.variants)
}

function Get-NotaraInstallFrame {
    param(
        [Parameter(Mandatory = $true)]$Outline,
        [ValidateRange(0, 100)][int]$Percent,
        [string]$Stage,
        [int]$Width = 80,
        [int]$RevealedRows = -1,
        [switch]$Preview,
        [switch]$Failed
    )
    $rows = @($Outline.lines)
    $limit = [int][Math]::Floor($rows.Count * $Percent / 100)
    if ($RevealedRows -ge 0) { $limit = [Math]::Min($limit, $RevealedRows) }
    $clean = ($Stage -replace '[\x00-\x1f\x7f]', ' ').Trim()
    # Keep the artwork on the left and reserve actual console cells for CJK.
    $sideColumn = 2 + $Outline.columns + 4
    $sideWidth = $Width - $sideColumn - 2
    $maxStage = [Math]::Max(0, [int][Math]::Floor(($sideWidth - 3) / 2))
    if ($clean.Length -gt $maxStage) { $clean = $clean.Substring(0, $maxStage) + '...' }
    $statusRow = [int][Math]::Floor($rows.Count / 2) - 3
    $title = if ($Failed) { '大肥鱼部署暂停' } elseif ($Percent -eq 100) { '大肥鱼下好啦!' } else { '大肥鱼部署中' }
    '  NOTARA / ' + $(if ($Preview) { '本地预览，不执行实际安装' } else { 'SETUP' })
    ''
    for ($index = 0; $index -lt $rows.Count; $index++) {
        $art = if ($index -lt $limit) { $rows[$index] } else { '' }
        $label = switch ($index - $statusRow) {
            0 { $title }
            2 { $Percent.ToString() + '%' }
            4 { $clean }
            6 { if ($Failed) { '进度停在这里，先处理报错。' } elseif ($Percent -eq 100) { '从头到脚，都画好啦。' } else { '一点一点，把大肥鱼画出来。' } }
            default { '' }
        }
        '  ' + $art.PadRight($Outline.columns + 4) + $label
    }
    # These blank rows belong to the frame. The closing prompt must stay below
    # the feet even on legacy conhost, which can wrap streamed Unicode writes.
    ''
    ''
}

function New-NotaraInstallDisplay {
    param([switch]$Plain, [switch]$Preview)
    $interactive = $false
    try {
        $interactive = -not $Plain -and $Host.Name -eq 'ConsoleHost' -and -not [Console]::IsOutputRedirected -and [Console]::WindowWidth -ge 76 -and [Console]::WindowHeight -ge 29
    } catch { }
    $width = 80
    $outline = $null
    try {
        $variants = @(Read-NotaraInstallOutline)
        if ($interactive) {
            $width = [Console]::WindowWidth
            $outline = $variants | Where-Object { $_.columns + 36 -le $width -and @($_.lines).Count + 8 -le [Console]::WindowHeight } | Sort-Object columns -Descending | Select-Object -First 1
        }
    } catch { $interactive = $false }
    if (-not $outline) { $interactive = $false }
    return [pscustomobject]@{ Interactive = $interactive; Preview = [bool]$Preview; Width = $width; Outline = $outline; Percent = 0; Revealed = 0; Top = -1; Height = 0; Finished = $false; PreviousLines = @() }
}

function Show-NotaraInstallCharacterProgress {
    param(
        [Parameter(Mandatory = $true)]$Display,
        [ValidateRange(0, 100)][int]$Percent,
        [string]$Stage,
        [switch]$Animate,
        [switch]$Failed
    )
    if ($Display.Finished) { return }
    $previousPercent = $Display.Percent
    $Display.Percent = [Math]::Max($Display.Percent, $Percent)
    # A failure must not claim that installation completed.
    if ($Failed) { $Display.Percent = [Math]::Min(99, $Display.Percent) }
    if ($Display.Interactive) {
        try {
            if ([Console]::WindowWidth -ne $Display.Width -or [Console]::WindowHeight -lt @($Display.Outline.lines).Count + 8) { throw 'Console resized; continue with plain progress.' }
            $first = if ($Animate -and -not $Failed) { $previousPercent } else { $Display.Percent }
            for ($at = $first; $at -le $Display.Percent; $at++) {
                $lines = @(Get-NotaraInstallFrame -Outline $Display.Outline -Percent $at -Stage $Stage -Width $Display.Width -Preview:$Display.Preview -Failed:$Failed)
                if ($Display.Top -lt 0) {
                    $Display.Height = $lines.Count
                    [Console]::Write((' ' + [Environment]::NewLine) * ($Display.Height + 1))
                    $Display.Top = [Console]::CursorTop - $Display.Height - 1
                }
                # Write an exact cell rectangle instead of streaming text: no
                # automatic newline can overwrite the feet or the side panel.
                $cellRows = @($lines | ForEach-Object { $_ + (' ' * [Math]::Max(0, $Display.Width - 1 - $Host.UI.RawUI.LengthInBufferCells($_))) })
                # Updating only changed rows avoids repainting the full outline
                # 100 times (especially expensive in a Windows Terminal PTY).
                $start = -1
                for ($line = 0; $line -le $cellRows.Count; $line++) {
                    $dirty = $line -lt $cellRows.Count -and ($line -ge $Display.PreviousLines.Count -or $cellRows[$line] -cne $Display.PreviousLines[$line])
                    if ($dirty -and $start -lt 0) { $start = $line }
                    if (-not $dirty -and $start -ge 0) {
                        # PS 5.1 RawUI mismeasures CJK in UTF-8 consoles. Keep
                        # the fixed-cell artwork there, but let WriteConsole
                        # render each short, width-budgeted CJK label natively.
                        $block = @($cellRows[$start..($line - 1)] | ForEach-Object {
                            $wide = [regex]::Match($_, '[^\x00-\x7f\u2800-\u28ff]')
                            $prefix = if ($wide.Success) { $_.Substring(0, $wide.Index) } else { $_ }
                            $prefix.PadRight($Display.Width - 1)
                        })
                        $cells = $Host.UI.RawUI.NewBufferCellArray([string[]]$block, [ConsoleColor]::Cyan, [Console]::BackgroundColor)
                        if ($cells.GetLength(1) -gt $Display.Width - 1) { throw 'Frame exceeds the current console width.' }
                        $origin = New-Object Management.Automation.Host.Coordinates(0, ($Display.Top + $start))
                        $Host.UI.RawUI.SetBufferContents($origin, $cells)
                        $oldColor = [Console]::ForegroundColor
                        try {
                            [Console]::ForegroundColor = [ConsoleColor]::Cyan
                            for ($labelRow = $start; $labelRow -lt $line; $labelRow++) {
                                $wide = [regex]::Match($cellRows[$labelRow], '[^\x00-\x7f\u2800-\u28ff]')
                                if ($wide.Success) {
                                    [Console]::SetCursorPosition($wide.Index, ($Display.Top + $labelRow))
                                    [Console]::Write($cellRows[$labelRow].Substring($wide.Index).TrimEnd())
                                }
                            }
                        } finally { [Console]::ForegroundColor = $oldColor }
                        $start = -1
                    }
                }
                $Display.PreviousLines = $cellRows
                [Console]::SetCursorPosition(0, $Display.Top + $Display.Height)
                if ($Animate -and $at -lt $Display.Percent) { Start-Sleep -Milliseconds 35 }
            }
            $Display.Revealed = [int][Math]::Floor(@($Display.Outline.lines).Count * $Display.Percent / 100)
        } catch {
            $Display.Interactive = $false
            Write-Host '窗口显示条件已变化，后续进度改用文字显示。' -ForegroundColor Cyan
        }
    }
    if (-not $Display.Interactive) {
        $filled = [int][Math]::Floor($Display.Percent / 5)
        $title = if ($Failed) { '大肥鱼部署暂停' } elseif ($Display.Percent -eq 100) { '大肥鱼下好啦!' } else { '大肥鱼部署中' }
        Write-Host ('[' + ('#' * $filled) + ('-' * (20 - $filled)) + '] ' + $Display.Percent + '% ' + $title + ' ' + ($Stage -replace '[\x00-\x1f\x7f]', ' ')) -ForegroundColor Cyan
    }
    if ($Failed -or $Display.Percent -eq 100) { $Display.Finished = $true }
}

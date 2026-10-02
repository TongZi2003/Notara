@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-install.ps1" %*
set "installResult=%ERRORLEVEL%"
if not "%installResult%"=="0" (
    echo.
    echo Notara installation did not complete. Review the error above.
    pause
)
exit /b %installResult%

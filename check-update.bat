@echo off
setlocal EnableDelayedExpansion

:: ==========================================================
::  Ornament Replacer Extension - Update Checker
::  Runs OUTSIDE Illustrator to bypass firewall restrictions.
::  Writes result to %%TEMP%%\ornamentreplacer-update\status.json
::
::  If this batch fails when run from Illustrator, the user
::  can run it manually from Windows Explorer and then click
::  "Check for Updates" again in the Settings panel.
:: ==========================================================

set "UPDATE_DIR=%TEMP%\ornamentreplacer-update"
set "REMOTE_VERSION_URL=https://raw.githubusercontent.com/mhdmuzakkir/ornamentReplacer/main/version.json?nocache=%RANDOM%%RANDOM%"

:: Ensure temp dir exists
if not exist "%UPDATE_DIR%" mkdir "%UPDATE_DIR%"

:: Clear previous status and remote version
del "%UPDATE_DIR%\status.json" 2>nul
del "%UPDATE_DIR%\remote-version.json" 2>nul

:: Write "checking" status immediately
echo {"status":"checking","stage":"check","message":"Downloading version info..."} > "%UPDATE_DIR%\status.json"

:: Download remote version.json using PowerShell Net.WebClient
:: This runs outside the Illustrator process, so it usually bypasses app-level firewalls.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $wc=New-Object Net.WebClient; $wc.DownloadFile('%REMOTE_VERSION_URL%','%UPDATE_DIR%\remote-version.json'); exit 0 } catch { exit 1 }" >nul 2>&1

if errorlevel 1 (
    :: Fallback: bitsadmin (older Windows, deprecated but still functional)
    bitsadmin /transfer orn-check /download /priority normal "%REMOTE_VERSION_URL%" "%UPDATE_DIR%\remote-version.json" >nul 2>&1
)

if not exist "%UPDATE_DIR%\remote-version.json" (
    echo {"status":"error","stage":"check","message":"Network download failed. If you are behind a firewall, run this batch file manually from Windows Explorer, then return to Illustrator and click Check again."} > "%UPDATE_DIR%\status.json"
    exit /b 1
)

:: Success
echo {"status":"checked","stage":"check","message":"Remote version info downloaded successfully"} > "%UPDATE_DIR%\status.json"
exit /b 0

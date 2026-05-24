@echo off
setlocal EnableDelayedExpansion

:: ==========================================================
::  Ornament Replacer - Updater (Robust ZIP-based update)
::  Runs OUTSIDE Illustrator to bypass firewall restrictions.
::  Can be run standalone (double-click) or from updater.js.
::  Writes result to %%TEMP%%\ornamentreplacer-update\status.json
::
::  Usage:
::    update.bat                    -> Updates AppData install
::    update.bat "<extension_path>" -> Updates specific path
:: ==========================================================

:: Target directory: argument or default to AppData
if "%~1"=="" (
    set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\ornamentReplacer"
) else (
    set "TARGET_DIR=%~1"
)

set "ZIP_URL=https://github.com/mhdmuzakkir/ornamentReplacer/archive/refs/heads/main.zip?nocache=%RANDOM%%RANDOM%"
set "UPDATE_DIR=%TEMP%\ornamentreplacer_upd_%RANDOM%%RANDOM%"
set "STATUS_DIR=%TEMP%\ornamentreplacer-update"
set "ZIP_FILE=%TEMP%\ornamentreplacer_dl_%RANDOM%.zip"

:: Ensure status dir exists
if not exist "%STATUS_DIR%" mkdir "%STATUS_DIR%"

echo ==========================================
echo   Ornament Replacer - Updater
echo ==========================================
echo.

:: Verify target exists
if not exist "%TARGET_DIR%" (
    echo [ERROR] Extension not found at:
    echo   %TARGET_DIR%
    echo.
    echo Run install.bat first, or pass the correct path as argument.
    echo {"status":"error","stage":"install","message":"Extension not found at %TARGET_DIR%. Run install.bat first."} > "%STATUS_DIR%\status.json"
    if "%~1"=="" pause
    exit /b 1
)

:: Check if target is writable (Program Files installs cannot self-update)
echo Checking permissions...
set "TEST_FILE=%TARGET_DIR%\.__write_test_%RANDOM%"
type nul > "%TEST_FILE%" 2>nul
if not exist "%TEST_FILE%" (
    echo [ERROR] Cannot write to extension folder.
    echo   %TARGET_DIR%
    echo.
    echo If installed in Program Files, run as Administrator,
    echo or reinstall to AppData using install.bat
    echo {"status":"error","stage":"install","message":"Permission denied. Program Files installs cannot self-update. Reinstall to AppData or run as Administrator."} > "%STATUS_DIR%\status.json"
    if "%~1"=="" pause
    exit /b 1
)
del /F /Q "%TEST_FILE%" 2>nul

:: Clean old temp files completely
if exist "%UPDATE_DIR%" (
    rmdir /S /Q "%UPDATE_DIR%" 2>nul
    timeout /t 1 /nobreak >nul
)
if exist "%ZIP_FILE%" del /F /Q "%ZIP_FILE%" 2>nul

:: ==========================================================
::  GIT FIRST: If this is a cloned repo, use git pull
:: ==========================================================
if exist "%TARGET_DIR%\.git" (
    echo {"status":"updating","stage":"git","message":"Git repository detected. Running git pull..."} > "%STATUS_DIR%\status.json"
    echo Git repository detected. Running git pull...
    cd /d "%TARGET_DIR%"
    git pull origin main >nul 2>&1
    if !errorlevel! equ 0 (
        echo {"status":"done","stage":"install","message":"Updated via git pull. Please restart Illustrator."} > "%STATUS_DIR%\status.json"
        echo.
        echo ==========================================
        echo   SUCCESS - Updated via Git
        echo ==========================================
        echo.
        if "%~1"=="" pause
        exit /b 0
    ) else (
        echo [ERROR] git pull failed. Please resolve conflicts manually,
        echo         or remove the .git folder to use ZIP fallback.
        echo {"status":"error","stage":"git","message":"git pull failed. Resolve conflicts manually or remove .git to use ZIP fallback."} > "%STATUS_DIR%\status.json"
        if "%~1"=="" pause
        exit /b 1
    )
)

:: Write status
echo {"status":"downloading","stage":"download","message":"Downloading update from GitHub..."} > "%STATUS_DIR%\status.json"

:: Download ZIP to explicit temp file
echo Downloading from GitHub...
powershell -NoProfile -Command "$wc=New-Object Net.WebClient; $wc.DownloadFile('%ZIP_URL%','%ZIP_FILE%')"
if not exist "%ZIP_FILE%" (
    echo [ERROR] Download failed. Check internet connection.
    echo {"status":"error","stage":"download","message":"Failed to download update ZIP. Check internet connection."} > "%STATUS_DIR%\status.json"
    if "%~1"=="" pause
    exit /b 1
)

:: Extract to completely separate temp folder
echo {"status":"extracting","stage":"extract","message":"Extracting update..."} > "%STATUS_DIR%\status.json"
echo Extracting...
mkdir "%UPDATE_DIR%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%UPDATE_DIR%' -Force"

:: Find the extracted subfolder (GitHub adds -main suffix)
set "SOURCE_DIR="
for /d %%D in ("%UPDATE_DIR%\*") do (
    set "SOURCE_DIR=%%D"
    goto :found_source
)
:found_source

if not defined SOURCE_DIR (
    echo [ERROR] Could not find extracted files.
    del /F /Q "%ZIP_FILE%" 2>nul
    echo {"status":"error","stage":"extract","message":"Could not find extracted files after ZIP extraction."} > "%STATUS_DIR%\status.json"
    if "%~1"=="" pause
    exit /b 1
)

echo Source found: %SOURCE_DIR%

:: Copy using ROBOCOPY (update existing files, add new ones, don't delete extras in target)
echo {"status":"copying","stage":"copy","message":"Copying files to extension folder..."} > "%STATUS_DIR%\status.json"
echo Installing files...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /NFL /NDL /NJH /NJS /nc /ns /np
set "ROBO_ERR=!errorlevel!"

:: Robocopy exit codes: 0-7 = success (0=no changes, 1=files copied, 2=extra files, 3=files+extras, 4=mismatches, 5=files+mismatches, 6=extras+mismatches, 7=all), 8+ = error
if !ROBO_ERR! geq 8 (
    echo [WARNING] Robocopy had issues ^(code: !ROBO_ERR!^), retrying with xcopy...
    xcopy "%SOURCE_DIR%\*" "%TARGET_DIR%\" /E /Y /I /Q 2>nul
)

:: Verify installation
if not exist "%TARGET_DIR%\CSXS\manifest.xml" (
    if not exist "%TARGET_DIR%\manifest.xml" (
        echo [ERROR] Update incomplete. manifest.xml not found.
        echo Source had:
        dir "%SOURCE_DIR%" /b
        echo {"status":"error","stage":"install","message":"Update incomplete. manifest.xml not found after copy."} > "%STATUS_DIR%\status.json"
        if "%~1"=="" pause
        exit /b 1
    )
)

:: Cleanup temp files
echo {"status":"cleaning","stage":"clean","message":"Cleaning up temporary files..."} > "%STATUS_DIR%\status.json"
echo Cleaning up...
rmdir /S /Q "%UPDATE_DIR%" 2>nul
del /F /Q "%ZIP_FILE%" 2>nul

:: Count installed files
for /f %%A in ('dir "%TARGET_DIR%" /s /b ^| find /c /v ""') do set "FILE_COUNT=%%A"

echo.
echo ==========================================
echo   SUCCESS - Update Complete
echo ==========================================
echo.
echo Location: %TARGET_DIR%
echo Files: %FILE_COUNT%
echo.
echo NEXT STEPS:
echo 1. CLOSE Illustrator completely if running
echo 2. Reopen Illustrator
echo 3. The updated extension will load automatically
echo.

:: Write final status
echo {"status":"done","stage":"install","message":"Update installed successfully. Please restart Illustrator."} > "%STATUS_DIR%\status.json"
if "%~1"=="" pause
endlocal
exit /b 0

@echo off
setlocal EnableDelayedExpansion

:: ==========================================================
::  Ornament Replacer - Team Installer (Run from Anywhere)
:: ==========================================================

set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\ornamentReplacer"
set "ZIP_URL=https://github.com/mhdmuzakkir/ornamentReplacer/archive/refs/heads/main.zip"
set "UPDATE_DIR=%TEMP%\ornamentreplacer_inst_%RANDOM%%RANDOM%"

echo ==========================================
echo   Ornament Replacer - Team Installer
echo ==========================================
echo.

:: Create target directory
echo Preparing installation...
if not exist "%APPDATA%\Adobe\CEP\extensions" (
    mkdir "%APPDATA%\Adobe\CEP\extensions" 2>nul
)

:: Clean old temp files completely
if exist "%UPDATE_DIR%" (
    rmdir /S /Q "%UPDATE_DIR%" 2>nul
    timeout /t 1 /nobreak >nul
)
if exist "%UPDATE_DIR%.zip" del /F /Q "%UPDATE_DIR%.zip" 2>nul

:: Download ZIP to explicit temp file
echo Downloading from GitHub...
set "ZIP_FILE=%TEMP%\ornamentreplacer_dl_%RANDOM%.zip"
powershell -NoProfile -Command "$wc=New-Object Net.WebClient; $wc.DownloadFile('%ZIP_URL%','%ZIP_FILE%')"
if not exist "%ZIP_FILE%" (
    echo [ERROR] Download failed. Check internet connection.
    pause
    exit /b 1
)

:: Extract to completely separate temp folder
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
    pause
    exit /b 1
)

echo Source found: %SOURCE_DIR%

:: Remove old installation if exists
if exist "%TARGET_DIR%" (
    echo Removing old version...
    rmdir /S /Q "%TARGET_DIR%" 2>nul
    timeout /t 2 /nobreak >nul
)

:: Create fresh target
mkdir "%TARGET_DIR%" 2>nul

:: Copy using ROBOCOPY with explicit excludes to prevent cyclic issues
echo Installing files...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /XD "ornamentReplacer" /NFL /NDL /NJH /NJS /nc /ns /np
set "ROBO_ERR=!errorlevel!"

:: Robocopy exit codes: 0-7 = success, 8+ = error
if !ROBO_ERR! geq 8 (
    echo [WARNING] Robocopy had issues (code: !ROBO_ERR!), retrying with xcopy...
    xcopy "%SOURCE_DIR%\*" "%TARGET_DIR%\" /E /Y /I /Q 2>nul
)

:: Verify installation
if not exist "%TARGET_DIR%\CSXS\manifest.xml" (
    if not exist "%TARGET_DIR%\manifest.xml" (
        echo [ERROR] Installation incomplete. manifest.xml not found.
        echo Source had: 
        dir "%SOURCE_DIR%" /b
        pause
        exit /b 1
    )
)

:: Cleanup temp files
echo Cleaning up...
rmdir /S /Q "%UPDATE_DIR%" 2>nul
del /F /Q "%ZIP_FILE%" 2>nul

:: Enable CEP debug mode
echo.
echo Enabling CEP debug mode...
for %%V in (11 12 13 14 15) do (
    reg delete "HKCU\SOFTWARE\Adobe\CSXS.%%V" /v PlayerDebugMode /f >nul 2>&1
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
    if !errorlevel! equ 0 echo   CSXS.%%V: OK
)

:: Count installed files
for /f %%A in ('dir "%TARGET_DIR%" /s /b ^| find /c /v ""') do set "FILE_COUNT=%%A"

echo.
echo ==========================================
echo   SUCCESS - Installation Complete
echo ==========================================
echo.
echo Location: %TARGET_DIR%
echo Files installed: %FILE_COUNT%
echo.
echo NEXT STEPS:
echo 1. CLOSE Illustrator completely if running
echo 2. Reopen Illustrator
echo 3. Window ^> Extensions ^> Ornament Replacer
echo.
pause
endlocal

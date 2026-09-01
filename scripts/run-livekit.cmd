@echo off
REM ===========================================================================
REM  Start the LiveKit voice server.
REM
REM  Voice needs two processes, not one: the Atrium server carries the
REM  signalling, and LiveKit carries the actual audio and camera. Only the
REM  first of them had a scheduled task, so LiveKit was whatever somebody had
REM  last started by hand - in practice a nohup from a terminal session, whose
REM  parent had long since exited. Nothing would have restarted it, and a
REM  reboot would have come back up with chat working and voice silently dead.
REM
REM  Same shape as run-server.cmd: logs to a file, because there is no console
REM  when the task scheduler starts this.
REM ===========================================================================

setlocal
REM From the repo root: the config path in the command line is relative, and
REM so are the paths inside the config.
cd /d "%~dp0.."

if not exist "%~dp0..\logs" mkdir "%~dp0..\logs"

for /f "tokens=1-3 delims=/- " %%a in ("%date%") do set STAMP=%%c-%%b-%%a
set LOG=%~dp0..\logs\livekit-%STAMP%.log

echo. >> "%LOG%"
echo ==================================================== >> "%LOG%"
echo  started %date% %time% >> "%LOG%"
echo ==================================================== >> "%LOG%"

vendor\livekit-server.exe --config livekit.yaml >> "%LOG%" 2>&1

echo  exited %date% %time% with code %errorlevel% >> "%LOG%"
endlocal

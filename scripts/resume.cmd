@echo off
REM Bring Atrium back after it was stopped for a network test.
REM
REM Everything was stopped by hand and the scheduled tasks disabled, because
REM the watchdog would otherwise have restarted the server and LiveKit within
REM five minutes and quietly ruined the measurement.
setlocal
set "ROOT=%~dp0.."
schtasks /Change /TN "Atrium Server Watchdog" /ENABLE >nul 2>&1
schtasks /Change /TN "Atrium Backup" /ENABLE >nul 2>&1
wscript.exe //B //Nologo "%ROOT%\scripts\run-hidden.vbs" /nowait "%ROOT%\scripts\run-livekit.cmd"
wscript.exe //B //Nologo "%ROOT%\scripts\run-hidden.vbs" /nowait "%ROOT%\scripts\run-server.cmd"
echo Atrium is starting again. Give it a few seconds.
endlocal

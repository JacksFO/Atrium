@echo off
REM The nightly backup, as a script the hidden-launch shim can point at.
REM Task Scheduler cannot run "cmd /c ..." without opening a console, so the
REM task runs run-hidden.vbs and run-hidden.vbs runs this.
setlocal
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
node scripts\backup.mjs >> "logs\backup.log" 2>&1
endlocal

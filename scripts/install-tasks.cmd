@echo off
REM ===========================================================================
REM  Keep Atrium running, and keep a copy of it.
REM
REM  Two scheduled tasks:
REM    Atrium Server  - starts the server when you log in, and restarts it
REM                        if it ever stops
REM    Atrium Backup  - a snapshot every night at 04:00
REM
REM  schtasks rather than Register-ScheduledTask, which wants administrator.
REM
REM  RUN THIS FROM AN ELEVATED PROMPT. This used to say that a logon task did
REM  not need administrator; on this machine it does - the two ONLOGON tasks
REM  fail with "Access is denied" from an ordinary shell while the MINUTE and
REM  DAILY ones are created quite happily. That is a confusing way to find out,
REM  because the run looks half successful and the two tasks it did not create
REM  are the two that actually start things.
REM
REM  Nothing is lost if you forget: a failed create leaves the existing task
REM  alone, and the watchdog starts both the server and voice within five
REM  minutes anyway. The logon tasks only make that immediate.
REM
REM  Run this once. Run it again to update the tasks; it replaces them.
REM ===========================================================================

setlocal
cd /d "%~dp0.."
set ROOT=%cd%

echo.
echo  Installing scheduled tasks for %ROOT%
echo.

REM --- the server -----------------------------------------------------------
REM ONLOGON rather than ONSTART: ONSTART needs administrator and stored
REM credentials. The trade is that the server starts when you sign in rather
REM than when the machine powers on - see the note at the end.
schtasks /Create /F /TN "Atrium Server" ^
  /TR "wscript.exe //B //Nologo \"%ROOT%\scripts\run-hidden.vbs\" \"%ROOT%\scripts\run-server.cmd\"" ^
  /SC ONLOGON /RL LIMITED >nul 2>&1

if errorlevel 1 (
  echo  [!] Could not create the server task.
) else (
  echo  [ok] Atrium Server        starts when you log in
)

REM Restart it if it dies. A separate task rather than a wrapper loop, so a
REM crash loop is visible in the task history instead of hidden in a batch file.
REM
REM The check itself lives in watchdog.cmd. The old one asked whether any
REM node.exe was running, and a machine with an editor open always has
REM several - so it never restarted anything. It asks about the port now.
REM Through run-hidden.vbs, not straight at the .cmd. An interactive task
REM running a batch file opens a console window every time it fires - every
REM five minutes, all day, over the top of whatever is fullscreen.
REM
REM These three lines used to sit after the /TN, between the caret and the
REM /TR. A caret escapes the newline, so the next line is joined onto this
REM one - schtasks was being handed the word REM as an argument and refused
REM the whole command. The task on this machine predates that edit, so
REM nothing looked broken until somebody re-ran this to update it.
schtasks /Create /F /TN "Atrium Server Watchdog" ^
  /TR "wscript.exe //B //Nologo \"%ROOT%\scripts\run-hidden.vbs\" \"%ROOT%\scripts\watchdog.cmd\"" ^
  /SC MINUTE /MO 5 /RL LIMITED >nul 2>&1

if errorlevel 1 (
  echo  [!] Could not create the watchdog task.
) else (
  echo  [ok] Atrium Server Watchdog  checks every 5 minutes
)

REM --- voice ----------------------------------------------------------------
REM LiveKit is a second process, and it had neither a task nor a watchdog. It
REM was whatever somebody last started by hand - here, a nohup whose parent
REM had long since exited - so a reboot would have come back with chat working
REM and voice quietly dead.
schtasks /Create /F /TN "Atrium Voice" ^
  /TR "wscript.exe //B //Nologo \"%ROOT%\scripts\run-hidden.vbs\" \"%ROOT%\scripts\run-livekit.cmd\"" ^
  /SC ONLOGON /RL LIMITED >nul 2>&1

if errorlevel 1 (
  echo  [!] Could not create the voice task.
) else (
  echo  [ok] Atrium Voice         starts when you log in
)

REM --- the backup -----------------------------------------------------------
schtasks /Create /F /TN "Atrium Backup" ^
  /TR "wscript.exe //B //Nologo \"%ROOT%\scripts\run-hidden.vbs\" \"%ROOT%\scripts\backup.cmd\"" ^
  /SC DAILY /ST 04:00 /RL LIMITED >nul 2>&1

if errorlevel 1 (
  echo  [!] Could not create the backup task.
) else (
  echo  [ok] Atrium Backup        every night at 04:00
)

echo.
echo  Done. Check them with:   schtasks /Query /TN "Atrium Server"
echo  Remove them with:        schtasks /Delete /TN "Atrium Server" /F
echo.
echo  Two things worth knowing:
echo.
echo   * These start at logon, not at boot. If the machine reboots and nobody
echo     signs in, the server stays down. To survive that, run this from an
echo     administrator prompt after changing /SC ONLOGON to /SC ONSTART.
echo.
echo   * The backup is only a real backup once it is somewhere else. Point
echo     OneDrive or Dropbox at the backups folder, or copy it to a drive that
echo     is not this one. Set BACKUP_PASSPHRASE in .env first.
echo.
endlocal

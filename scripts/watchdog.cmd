@echo off
REM Is Atrium actually answering?
REM
REM The first test was "is any node.exe running", which on a machine with an
REM editor, a package manager and a build tool open is always true - so the
REM watchdog never restarted anything. The port was better, but only just: a
REM process wedged badly enough to serve nobody still holds its socket open,
REM and "something is listening" was true throughout every fault this has
REM ever had.
REM
REM So ask the app instead. /health touches the database and answers, which
REM is the smallest question a wedged process cannot get right.
REM
REM Two processes are checked, not one. Voice is a separate program - the app
REM carries the signalling, LiveKit carries the audio - and it used to have no
REM watchdog and no task at all. Losing it takes voice away while chat carries
REM on working, which is the kind of fault nobody reports for a week because
REM everyone assumes it is their end.
REM
REM Both checks live in ONE powershell invocation on purpose. This runs every
REM five minutes on a machine somebody games on, and a cold PowerShell start
REM is by far the most expensive thing here - so the cost of watching voice as
REM well should be, and is, nothing.

setlocal
set "ROOT=%~dp0.."
set "PORT="
set "SCHEME=https"

for /f "tokens=2 delims==" %%p in ('findstr /b /c:"PORT=" "%ROOT%\.env" 2^>nul') do set "PORT=%%p"
if not defined PORT set "PORT=443"
for /f "tokens=2 delims==" %%t in ('findstr /b /c:"TLS=" "%ROOT%\.env" 2^>nul') do (
  if /i "%%t"=="false" set "SCHEME=http"
)

REM The signalling port LiveKit listens on. The app proxies /livekit to it, so
REM if this is not open there is no voice however healthy the app looks.
set "VOICEPORT=7880"

REM The certificate is often self-signed on the local address, so the check
REM deliberately does not validate it - this is a liveness probe against our
REM own machine, not a trust decision.
REM
REM Exit code is a bitmask: 1 = the app is down, 2 = voice is down, 3 = both.
powershell -NoProfile -Command ^
  "$bad = 0;" ^
  "try { $h = [Net.HttpWebRequest]::Create('%SCHEME%://localhost:%PORT%/health');" ^
  "$h.Timeout = 8000;" ^
  "$h.ServerCertificateValidationCallback = { $true };" ^
  "$r = $h.GetResponse();" ^
  "if ([int]$r.StatusCode -ne 200) { $bad = $bad -bor 1 } } catch { $bad = $bad -bor 1 };" ^
  "try { $c = New-Object Net.Sockets.TcpClient;" ^
  "if (-not $c.ConnectAsync('127.0.0.1', %VOICEPORT%).Wait(5000)) { $bad = $bad -bor 2 };" ^
  "$c.Close() } catch { $bad = $bad -bor 2 };" ^
  "exit $bad"

set "STATE=%errorlevel%"

REM Bit 0: the app. A wedged process still holds the port, so anything still
REM there has to go before a new one can bind it.
if "%STATE%"=="1" goto :app
if "%STATE%"=="3" goto :app
goto :voice

:app
echo [watchdog] Atrium is not answering on %PORT%, restarting it
powershell -NoProfile -Command ^
  "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue |" ^
  "Select-Object -ExpandProperty OwningProcess |" ^
  "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
REM Hidden, or the watchdog would trade its own window for the server's.
REM /nowait, or this watchdog run never ends - and the task will not start a
REM second copy while one is running, so it would be the last check ever made.
wscript.exe //B //Nologo "%ROOT%\scripts\run-hidden.vbs" /nowait "%ROOT%\scripts\run-server.cmd"

:voice
REM Bit 1: voice.
if "%STATE%"=="2" goto :restartvoice
if "%STATE%"=="3" goto :restartvoice
goto :done

:restartvoice
echo [watchdog] LiveKit is not answering on %VOICEPORT%, restarting it
powershell -NoProfile -Command ^
  "Get-Process livekit-server -ErrorAction SilentlyContinue |" ^
  "ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }"
wscript.exe //B //Nologo "%ROOT%\scripts\run-hidden.vbs" /nowait "%ROOT%\scripts\run-livekit.cmd"

:done
REM Up. Say nothing - this runs every five minutes.
endlocal

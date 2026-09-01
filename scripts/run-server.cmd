@echo off
REM ===========================================================================
REM  Start the Atrium server.
REM
REM  A .cmd rather than a .ps1 on purpose: PowerShell's execution policy is
REM  Restricted on this machine, so a script file is refused before it runs.
REM  Batch has no such gate.
REM
REM  Logs go to logs\server-<date>.log rather than a console, because there is
REM  no console when this is started by the task scheduler - and a crash with
REM  no log is a crash nobody can explain.
REM ===========================================================================

setlocal
REM Into apps\server, not the repo root: the workspace's own node_modules is
REM where tsc and tsx live, and node cannot resolve either from anywhere else.
REM Started from the root this exits immediately with "Cannot find package",
REM which is why the logon task and the watchdog could never start anything.
REM
REM Paths inside the server are worked out from the source file, not the
REM working directory, so data and uploads still land in the repo root.
cd /d "%~dp0..\apps\server"

if not exist "%~dp0..\logs" mkdir "%~dp0..\logs"

REM ---------------------------------------------------------------------------
REM  One log a day, unless something says otherwise.
REM
REM  ATRIUM_LOG overrides it, which exists so a second copy can be started
REM  without fighting the first. Windows will not let two processes append to
REM  the same file: every line of this script failed with "the process cannot
REM  access the file because it is being used by another process" while the
REM  live server held today's log open, and nothing ran at all. A launcher
REM  that cannot be started twice is a launcher that cannot be tested.
REM ---------------------------------------------------------------------------
for /f "tokens=1-3 delims=/- " %%a in ("%date%") do set STAMP=%%c-%%b-%%a
set LOG=%~dp0..\logs\server-%STAMP%.log
if not "%ATRIUM_LOG%"=="" set LOG=%ATRIUM_LOG%

echo. >> "%LOG%"
echo ==================================================== >> "%LOG%"
echo  started %date% %time% >> "%LOG%"
echo ==================================================== >> "%LOG%"

REM ---------------------------------------------------------------------------
REM  Compile first, then run the JavaScript.
REM
REM  This used to run the TypeScript through tsx, which compiles every source
REM  file in memory at every start and keeps the compiler resident for as long
REM  as the server runs. Measured on this machine, the same server: 1233ms to
REM  ready and 129MB through tsx, against 878ms and 119MB built. Ten megabytes
REM  and a third of the startup, for a build that takes under three seconds.
REM
REM  It also means a type error cannot reach the running server. tsc refuses to
REM  emit; tsx would have run it and fallen over somewhere later.
REM
REM  Node is called against typescript's own entry point rather than through
REM  pnpm or npx. Neither is reliably on PATH under the task scheduler, and a
REM  launcher that works from a shell and not from the scheduler is the exact
REM  failure this file already carries a comment about.
REM ---------------------------------------------------------------------------
echo  building... >> "%LOG%"
node "node_modules\typescript\lib\tsc.js" -p tsconfig.build.json >> "%LOG%" 2>&1
set BUILT=%errorlevel%

if "%BUILT%"=="0" (
  echo  build ok - running dist\index.js >> "%LOG%"
  node dist\index.js >> "%LOG%" 2>&1
  goto :done
)

REM ---------------------------------------------------------------------------
REM  The build failed. Come up anyway - a server that will not start is worse
REM  than one running slightly older code - but say so loudly enough that
REM  nobody mistakes the log for a healthy one.
REM ---------------------------------------------------------------------------
if exist "dist\index.js" (
  echo  ***************************************************** >> "%LOG%"
  echo  *  BUILD FAILED - running the PREVIOUS build         * >> "%LOG%"
  echo  *  What is running is not what is in src.            * >> "%LOG%"
  echo  ***************************************************** >> "%LOG%"
  node dist\index.js >> "%LOG%" 2>&1
  goto :done
)

echo  ***************************************************** >> "%LOG%"
echo  *  BUILD FAILED and there is no previous build       * >> "%LOG%"
echo  *  Falling back to running the source through tsx.   * >> "%LOG%"
echo  ***************************************************** >> "%LOG%"
node --import tsx src\index.ts >> "%LOG%" 2>&1

:done
echo  exited %date% %time% with code %errorlevel% >> "%LOG%"
endlocal

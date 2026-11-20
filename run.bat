@echo off
rem run.bat - one click: the API (back), the web app (front) and the recorder box (edge).
rem
rem Double-click it. It hands off to run.sh in Git Bash, so the LAN IP in the .env
rem files is kept current and Ctrl+C (or closing this window) stops everything.
rem Anything left running from before is stopped first, so the ports are free.

title Dyna Cam - back + front + edge
cd /d "%~dp0"

set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo Git Bash was not found. Install Git for Windows: https://git-scm.com/download/win
  pause
  exit /b 1
)

"%BASH%" ./run.sh stop
"%BASH%" ./run.sh back front edge

echo.
pause

@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "RailTimeline Web" http://localhost:8080
  py -m http.server 8080
) else (
  start "RailTimeline Web" http://localhost:8080
  python -m http.server 8080
)

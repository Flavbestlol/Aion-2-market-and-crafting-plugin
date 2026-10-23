@echo off
rem Starts the Dragon Gear Prices app (hidden, only reachable from this PC) and opens it in your browser.
rem If it is already running it is restarted first, so updates always take effect.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:7317/api/quit -Headers @{'X-Flav'='1'} -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null; Start-Sleep -Milliseconds 800 } catch {}"
start "" conhost.exe --headless "%~dp0app\node\node.exe" "%~dp0app\server.js"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:7317/

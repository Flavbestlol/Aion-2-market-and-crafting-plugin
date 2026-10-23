@echo off
rem Fetches the Node.js runtime the app runs on (one file, from nodejs.org) into app\node\.
rem Only needed after a git clone; the release zip already has it.
setlocal
set "V=v24.22.1"
cd /d "%~dp0.."
if exist "app\node\node.exe" (
  echo app\node\node.exe is already there.
  goto :eof
)
mkdir "app\node" 2>nul
echo Downloading Node.js %V% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/%V%/win-x64/node.exe' -OutFile 'app\node\node.exe'; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nodejs/node/%V%/LICENSE' -OutFile 'app\node\LICENSE'"
if exist "app\node\node.exe" (echo Done.) else (echo *** The download failed. Get node.exe from https://nodejs.org/dist/%V%/win-x64/ into app\node\ yourself.)
pause

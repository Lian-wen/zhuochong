@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set "APP=."
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%EXE%" (
  echo 第一次启动，正在安装 Electron，约 200MB，只装一次...
  call npm install --no-audit --no-fund
)
if not exist "%EXE%" (
  echo.
  echo 没装上 Electron。请在这个文件夹里执行一次：npm install
  echo.
  pause
  exit /b 1
)
start "" "%EXE%" "%APP%"

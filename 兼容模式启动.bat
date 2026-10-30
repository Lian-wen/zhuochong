@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set "APP=."
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%EXE%" (
  echo 没找到 Electron，先装一下...
  call npm install --no-audit --no-fund
)
echo 兼容模式：关掉硬件加速和沙箱，远程桌面 / 虚拟机 / 显卡驱动异常时用。
echo 这个窗口会一直开着，关掉它桌宠就退出了。
echo.
"%EXE%" "%APP%" --soft --no-sandbox
echo.
echo 桌宠已退出，退出码 %errorlevel%
echo 如果上面有报错，截图这段发我。
pause

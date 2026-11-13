@echo off
set "AGY_NODE=C:\Users\badha\AppData\Roaming\Antigravity\bin\agy-node.cmd"
if exist "%AGY_NODE%" (
  call "%AGY_NODE%" "%~dp0standalone_server.js" %*
) else (
  node "%~dp0standalone_server.js" %*
)
pause

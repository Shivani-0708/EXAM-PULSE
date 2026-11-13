@echo off
set "AGY_NODE=C:\Users\badha\AppData\Roaming\Antigravity\bin\agy-node.cmd"
if exist "%AGY_NODE%" (
  call "%AGY_NODE%" "%~dp0loadtest\run_all.js" %*
) else (
  node "%~dp0loadtest\run_all.js" %*
)
pause

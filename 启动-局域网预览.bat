@echo off
chcp 65001 >nul
setlocal

rem 年猪宴 · 局域网预览：把 H5 用 HTTP 方式共享给同一个 WiFi 下的手机
rem 用 Windows 自带的 PowerShell 起一个零依赖静态服务（本机没有 Node/Python 也没关系）

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0_build\serve.ps1"

echo.
echo 服务已结束。按任意键关闭窗口。
pause >nul

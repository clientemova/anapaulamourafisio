@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0iniciar-na-rede-local.ps1"
pause

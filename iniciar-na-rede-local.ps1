$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $appDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js nao foi encontrado neste computador."
  Write-Host "Instale o Node.js LTS e execute este arquivo novamente."
  Write-Host ""
  Read-Host "Pressione Enter para sair"
  exit 1
}

Write-Host ""
Write-Host "Iniciando o sistema de gestao de fisioterapia na rede local..."
Write-Host ""

$env:HOST = "0.0.0.0"
$env:PORT = "3080"
node server.js --host 0.0.0.0 --port 3080

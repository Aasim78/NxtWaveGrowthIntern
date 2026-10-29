$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 18 or later is required. Install Node.js, then run this script again."
}
node .\server.mjs

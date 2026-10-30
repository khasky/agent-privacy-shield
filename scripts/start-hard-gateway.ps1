param([string]$Upstream='https://api.anthropic.com',[int]$Port=7788)
$env:APS_UPSTREAM=$Upstream
$env:APS_PORT="$Port"
node (Join-Path $PSScriptRoot '..\gateway\privacy-gateway.mjs')

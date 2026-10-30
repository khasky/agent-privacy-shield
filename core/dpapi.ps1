param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('protect','unprotect')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()

if ($Mode -eq 'protect') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputText)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($protected))
  exit 0
}

$cipher = [Convert]::FromBase64String($inputText.Trim())
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))

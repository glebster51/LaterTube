param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$hostExe = Join-Path $projectRoot "native-host\bin\Release\net10.0\win-x64\publish\LaterTubeUsbSync.exe"
if (!(Test-Path -LiteralPath $hostExe)) {
    throw "Companion is missing. Run dotnet publish .\native-host -c Release -r win-x64 first."
}

$manifestPath = Join-Path $projectRoot "native-host\com.glebster51.latertube_usb_sync.json"
$manifest = [ordered]@{
    name = "com.glebster51.latertube_usb_sync"
    description = "LaterTube USB Sync Companion"
    path = $hostExe
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.glebster51.latertube_usb_sync"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Host "Native Messaging Host registered for $ExtensionId"

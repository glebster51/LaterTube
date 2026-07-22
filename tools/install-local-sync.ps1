param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$unitySdk = "C:\Program Files\Unity\Hub\Editor\6000.3.10f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK"
$adb = Join-Path $unitySdk "platform-tools\adb.exe"
if (!(Test-Path -LiteralPath $adb)) { $adb = "adb" }

$devices = & $adb devices
if ($devices -match "unauthorized") { throw "Allow USB debugging on Pixel 7, then run this script again." }
$authorizedDevices = @($devices | Select-String "`tdevice$")
if ($authorizedDevices.Count -ne 1) { throw "Connect exactly one authorized Android device." }

$wrapper = Join-Path $projectRoot "android\gradle\wrapper\gradle-wrapper.jar"
if (!(Test-Path -LiteralPath $wrapper)) { & (Join-Path $PSScriptRoot "download-gradle-wrapper.ps1") }

& (Join-Path $projectRoot "android\gradlew.bat") -p (Join-Path $projectRoot "android") :app:assembleDebug
$apk = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
& $adb install -r $apk
& $adb shell am start -n com.glebster51.latertube.localsync/.MainActivity
dotnet publish (Join-Path $projectRoot "native-host") -c Release -r win-x64
& (Join-Path $PSScriptRoot "install-native-host.ps1") -ExtensionId $ExtensionId
Write-Host "LaterTube Local Sync is installed. Reload the unpacked extension, then click Sync phone."

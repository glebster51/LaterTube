Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot "..\android\gradle\wrapper\gradle-wrapper.jar"
$uri = "https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar"
Invoke-WebRequest -Uri $uri -OutFile $target
Write-Host "Downloaded Gradle Wrapper to $target"

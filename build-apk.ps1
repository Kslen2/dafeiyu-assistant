param(
    [string]$ToolchainRoot = "$env:USERPROFILE\.cache\dafeiyu-android"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$projectLink = Join-Path $ToolchainRoot "project-link"
if (-not (Test-Path -LiteralPath $projectLink)) {
    New-Item -ItemType Junction -Path $projectLink -Target $projectRoot | Out-Null
}
$linkedProjectRoot = $projectLink
$androidRoot = Join-Path $linkedProjectRoot "android"
$jdkRoot = (Get-ChildItem -LiteralPath (Join-Path $ToolchainRoot "jdk-extract") -Directory | Select-Object -First 1).FullName
$gradleRoot = (Get-ChildItem -LiteralPath (Join-Path $ToolchainRoot "gradle-extract") -Directory | Select-Object -First 1).FullName
$sdkRoot = Join-Path $ToolchainRoot "sdk"

if (-not (Test-Path -LiteralPath (Join-Path $jdkRoot "bin\java.exe"))) { throw "JDK not found: $jdkRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $gradleRoot "bin\gradle.bat"))) { throw "Gradle not found: $gradleRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot "platforms\android-36"))) { throw "Android SDK 36 not found: $sdkRoot" }

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot

& powershell -ExecutionPolicy Bypass -File (Join-Path $projectRoot "tests\run-tests.ps1")
if ($LASTEXITCODE -ne 0) { throw "Web tests failed" }

Push-Location -LiteralPath $androidRoot
try {
    & (Join-Path $gradleRoot "bin\gradle.bat") --no-daemon --stacktrace :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Android build failed" }
} finally {
    Pop-Location
}

$versionLine = Select-String -LiteralPath (Join-Path $linkedProjectRoot "dist\app.js") -Pattern '^const APP_VERSION = "([^"]+)";' | Select-Object -First 1
if (-not $versionLine) { throw "Cannot read app version" }
$version = $versionLine.Matches[0].Groups[1].Value.Trim()
$builtApk = (Resolve-Path -LiteralPath (Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk")).Path
$appName = -join @([char]0x5927, [char]0x80A5, [char]0x9C7C, [char]0x52A9, [char]0x624B)
$destination = Join-Path $projectRoot "$appName-v$version.apk"
[System.IO.File]::Copy($builtApk, $destination, $true)
Get-Item -LiteralPath $destination | Select-Object FullName, Length, LastWriteTime

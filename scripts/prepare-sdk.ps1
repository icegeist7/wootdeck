# SPDX-License-Identifier: GPL-3.0-or-later
# Download the exact tested SDK DLL without installing Wootility or an MSI.
[CmdletBinding()]
param([string]$Destination)
$ErrorActionPreference = 'Stop'
if (!$Destination) { $Destination = Join-Path $PSScriptRoot '../tmp/cache/sdk/wooting-0.9.1' }
$dllHash = 'cdbbe1183e248ac18979de4f8e71bd2e26cb369daef835c1c7e3e64ecc09c5fb'
$archiveHash = '27b3b868f4005018d3638e0f485942272134e1e09be1db1747ccc63f33fc187a'
$uri = 'https://github.com/WootingKb/wooting-analog-sdk/releases/download/v0.9.1/wooting-analog-sdk-v0.9.1-x86_64-pc-windows-msvc.zip'
$directory = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$dll = Join-Path $directory 'wooting_analog_sdk.dll'
if (!(Test-Path -LiteralPath $dll) -or (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash -ne $dllHash) {
    $archive = Join-Path $directory 'sdk.zip'
    if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) {
        Invoke-WebRequest -Uri $uri -OutFile $archive -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) { throw 'SDK archive checksum mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entry = $zip.GetEntry('release/wooting_analog_sdk.dll')
        if (!$entry) { throw 'Release SDK DLL missing from archive' }
        $inputStream = $entry.Open()
        try {
            $outputStream = [IO.File]::Create($dll)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
    } finally { $zip.Dispose() }
}
if ((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash -ne $dllHash) { throw 'SDK DLL checksum mismatch' }
$env:WOOTING_SDK_DLL = $dll
Write-Host "Verified Wooting Analog SDK 0.9.1: $dll"

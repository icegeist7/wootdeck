# SPDX-License-Identifier: GPL-3.0-or-later
# Fail closed if private/local files enter the Git index or release archives.
[CmdletBinding()]
param([switch]$CheckIndex, [string]$SourceArchive, [string]$PluginArchive)
$ErrorActionPreference = 'Stop'
$plugin = 'com.firflabs.wootdeck.sdPlugin'
$publicRoots = @('.cargo', '.github', 'assets', $plugin, 'native', 'scripts', 'screenshots', 'src', 'tests')
$publicFiles = @('.gitattributes', '.gitignore', 'LICENSE', 'NOTICE.md', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json')

function Assert-PublicPath([string]$Name, [switch]$PackagedPlugin) {
    $normalized = $Name.Replace('\', '/')
    if ($normalized -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))') { throw "Unsafe archive path: $Name" }
    if ($normalized -match '(?i)(^|/)(internal|tmp|node_modules|logs?|\.git|\.codex|\.agents|\.tools|\.venv|__pycache__|target)(/|$)|(^|/)(concept|milestone[^/]*)(\.[^/]*)?$|(^|/)\.env[^/]*$|\.(log|pdb|pyc|pyo|map|pem|key)$') {
        throw "Private or generated file would be published: $Name"
    }
    if ($PackagedPlugin) {
        if ($normalized -notmatch "^$([regex]::Escape($plugin))/") { throw "Unexpected plugin root: $Name" }
        $relative = $normalized.Substring($plugin.Length + 1)
        if ($relative -notmatch '^(manifest\.json|LICENSE|NOTICE\.md|SOURCE\.txt|THIRD-PARTY-NOTICES\.md|ui/settings\.(html|js)|imgs/[^/]+\.png|licenses/.+|bin/(plugin\.js|wootdeck-helper\.exe|wooting_analog_sdk\.dll))$') {
            throw "Unexpected plugin file: $Name"
        }
    } else {
        $rootName = $normalized.Split('/')[0]
        if ($normalized.Contains('/')) {
            if ($rootName -notin $publicRoots) { throw "Unexpected source directory: $Name" }
        } elseif ($normalized -notin $publicFiles) { throw "Unexpected source file: $Name" }
        if ($normalized.StartsWith("$plugin/bin/")) { throw "Runtime binary in source tree: $Name" }
    }
}

if ($CheckIndex) {
    $tracked = @(& git -c core.quotepath=false ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot audit the Git index' }
    if (!$tracked.Count) { throw 'The Git index is empty' }
    foreach ($name in $tracked) { Assert-PublicPath $name }
    Write-Host "Public Git index checked: $($tracked.Count) files."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($archive in @(@{Path=$SourceArchive; IsPlugin=$false}, @{Path=$PluginArchive; IsPlugin=$true})) {
    if (!$archive.Path) { continue }
    $zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($archive.Path))
    try {
        $files = @($zip.Entries | Where-Object { !$_.FullName.EndsWith('/') })
        if (!$files.Count) { throw "Empty release archive: $($archive.Path)" }
        foreach ($entry in $files) {
            $name = $entry.FullName
            if (!$archive.IsPlugin) {
                if ($name -notmatch '^WootDeck-\d+\.\d+\.\d+/') { throw "Unexpected source archive root: $name" }
                $name = $name.Substring($name.IndexOf('/') + 1)
            }
            Assert-PublicPath $name -PackagedPlugin:$archive.IsPlugin
        }
        Write-Host "Release archive checked: $($archive.Path) ($($files.Count) files)."
    } finally { $zip.Dispose() }
}
if (!$CheckIndex -and !$SourceArchive -and !$PluginArchive) { throw 'Select the Git index or a release archive to audit' }

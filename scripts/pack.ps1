<#
.SYNOPSIS
  Pack UnionCodePet into a runnable win-unpacked folder WITHOUT electron-builder.

.DESCRIPTION
  electron-builder needs winCodeSign, whose extraction fails for non-admin
  users (symlink creation denied). This script sidesteps electron-builder
  entirely: it runs electron-vite build, then assembles a win-unpacked folder
  by copying the Electron runtime + our compiled code + pet/icon resources.

  The resulting folder runs directly (double-click UnionCodePet.exe). The exe
  keeps Electron's default name/icon (no rcedit), but everything else works.

  For a proper installer + custom exe icon, run electron-builder once as admin
  to populate the winCodeSign cache; after that, normal `npm run dist:win` works.
#>
$ErrorActionPreference = 'Stop'

$root = 'D:\AL\UnionCodePet'
$electronDist = Join-Path $root 'node_modules\electron\dist'
$out = Join-Path $root 'release\win-unpacked'

Write-Host '1) electron-vite build...'
Push-Location $root
npx electron-vite build
Pop-Location

Write-Host '2) clean release\win-unpacked...'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

Write-Host '3) copy Electron runtime...'
Copy-Item (Join-Path $electronDist '*') $out -Recurse -Force

Write-Host '4) copy compiled app (out/) -> resources\app\out\...'
$appDir = Join-Path $out 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
# Copy the out/ dir itself (preserving the out/ level) so package.json's
# "main": "out/main/index.js" resolves correctly under resources/app/.
Copy-Item (Join-Path $root 'out') $appDir -Recurse -Force

# package.json must sit at resources\app\package.json so Electron finds "main".
Copy-Item (Join-Path $root 'package.json') $appDir -Force

Write-Host '5) copy pets/ + build/ -> resources\ (extraResources)...'
Copy-Item (Join-Path $root 'pets') (Join-Path $out 'resources\pets') -Recurse -Force
Copy-Item (Join-Path $root 'build') (Join-Path $out 'resources\build') -Recurse -Force

Write-Host '6) rename electron.exe -> UnionCodePet.exe...'
Rename-Item (Join-Path $out 'electron.exe') 'UnionCodePet.exe'

Write-Host ''
Write-Host 'DONE. Output: ' $out
Write-Host 'Run: ' (Join-Path $out 'UnionCodePet.exe')

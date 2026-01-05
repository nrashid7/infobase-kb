# Setup PortableGit as the default Git installation
# Run this script once to configure your environment

$ErrorActionPreference = "Stop"

$PortableGitBin = "C:\Git\PortableGit\bin"
$PortableGitCmd = "C:\Git\PortableGit\cmd"
$GitExe = "$PortableGitBin\git.exe"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " PortableGit Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify PortableGit exists
Write-Host "[1/4] Verifying PortableGit installation..." -ForegroundColor Yellow
if (-not (Test-Path $GitExe)) {
    Write-Host "ERROR: PortableGit not found at $GitExe" -ForegroundColor Red
    Write-Host "Please install PortableGit to C:\Git\PortableGit" -ForegroundColor Red
    exit 1
}
$version = & $GitExe --version
Write-Host "  Found: $version" -ForegroundColor Green

# Step 2: Update User PATH
Write-Host ""
Write-Host "[2/4] Updating User PATH environment variable..." -ForegroundColor Yellow

$currentUserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$pathParts = $currentUserPath -split ";" | Where-Object { $_ -ne "" }

# Remove any existing PortableGit entries to avoid duplicates
$pathParts = $pathParts | Where-Object { 
    $_ -notlike "*PortableGit*" -and 
    $_ -notlike "*Git\bin*" -and 
    $_ -notlike "*Git\cmd*"
}

# Add PortableGit paths at the beginning
$newPathParts = @($PortableGitBin, $PortableGitCmd) + $pathParts
$newPath = $newPathParts -join ";"

[Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
Write-Host "  User PATH updated" -ForegroundColor Green

# Step 3: Update current session PATH
Write-Host ""
Write-Host "[3/4] Updating current session PATH..." -ForegroundColor Yellow

# Rebuild session PATH with PortableGit first
$sessionPath = $env:PATH -split ";" | Where-Object { $_ -ne "" }
$sessionPath = $sessionPath | Where-Object { 
    $_ -notlike "*PortableGit*" -and 
    $_ -notlike "*Git\bin*" -and 
    $_ -notlike "*Git\cmd*"
}
$env:PATH = (@($PortableGitBin, $PortableGitCmd) + $sessionPath) -join ";"
Write-Host "  Session PATH updated" -ForegroundColor Green

# Step 4: Verification
Write-Host ""
Write-Host "[4/4] Verifying configuration..." -ForegroundColor Yellow

$whereGit = (Get-Command git -ErrorAction SilentlyContinue).Source
if ($whereGit -eq $GitExe) {
    Write-Host "  git resolves to: $whereGit" -ForegroundColor Green
} else {
    Write-Host "  WARNING: git resolves to: $whereGit" -ForegroundColor Yellow
    Write-Host "  Expected: $GitExe" -ForegroundColor Yellow
    Write-Host "  You may need to restart your terminal." -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PortableGit is now configured as the default Git." -ForegroundColor Green
Write-Host ""
Write-Host "Verification commands:" -ForegroundColor White
Write-Host "  where.exe git       # Should show $GitExe first" -ForegroundColor Gray
Write-Host "  git --version       # Should work without full path" -ForegroundColor Gray
Write-Host ""
Write-Host "NOTE: Restart any open terminals/Cursor for changes to take effect." -ForegroundColor Yellow


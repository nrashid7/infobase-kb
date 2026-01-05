# Clean Zip Export Script for infobase-kb
# Creates a shareable zip without repository bloat
#
# Usage: .\scripts\export_clean_zip.ps1
# Output: dist/infobase-kb-clean.zip

param(
    [string]$OutputDir = "dist",
    [string]$ZipName = "infobase-kb-clean.zip"
)

$ErrorActionPreference = "Stop"

# Get project root (parent of scripts directory)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "[ZIP] Creating clean export zip..." -ForegroundColor Cyan
Write-Host "      Project root: $ProjectRoot"

# Create output directory if it doesn't exist
$OutputPath = Join-Path $ProjectRoot $OutputDir
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "      Created output directory: $OutputPath"
}

$ZipPath = Join-Path $OutputPath $ZipName

# Remove existing zip if present
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
    Write-Host "      Removed existing zip: $ZipPath"
}

# Create a temporary directory for clean copy
$TempDir = Join-Path $env:TEMP "infobase-kb-clean-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
Write-Host "      Temporary directory: $TempDir"

try {
    # Define exclusion patterns
    $ExcludePatterns = @(
        '.git',
        '.cursor',
        'node_modules',
        'kb\runs',
        'kb\snapshots',
        'kb\indexes',
        'dist',
        'Thumbs.db',
        '.DS_Store',
        '*.log'
    )

    Write-Host ""
    Write-Host "[COPY] Copying files..." -ForegroundColor Yellow

    # Get all files and directories, excluding unwanted ones
    $items = Get-ChildItem -Path $ProjectRoot -Recurse -Force | Where-Object {
        $relativePath = $_.FullName.Substring($ProjectRoot.Length + 1)
        $exclude = $false
        
        foreach ($pattern in $ExcludePatterns) {
            # Check if path starts with or matches exclusion pattern
            if ($relativePath -like "$pattern*" -or $relativePath -like "*\$pattern*" -or $relativePath -like "*\$pattern") {
                $exclude = $true
                break
            }
            # Check for file patterns (like *.log)
            if ($pattern -like "*.*" -and $_.Name -like $pattern) {
                $exclude = $true
                break
            }
        }
        
        -not $exclude
    }

    # Copy files maintaining directory structure
    $fileCount = 0
    foreach ($item in $items) {
        $relativePath = $item.FullName.Substring($ProjectRoot.Length + 1)
        $destPath = Join-Path $TempDir $relativePath
        
        if ($item.PSIsContainer) {
            if (-not (Test-Path $destPath)) {
                New-Item -ItemType Directory -Path $destPath -Force | Out-Null
            }
        } else {
            $destDir = Split-Path -Parent $destPath
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            Copy-Item -Path $item.FullName -Destination $destPath -Force
            $fileCount++
        }
    }

    Write-Host "       Copied $fileCount files"

    # Create the zip archive
    Write-Host ""
    Write-Host "[ZIP] Creating zip archive..." -ForegroundColor Yellow
    Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

    # Get zip file size
    $zipSize = (Get-Item $ZipPath).Length
    $zipSizeMB = [math]::Round($zipSize / 1MB, 2)

    Write-Host ""
    Write-Host "[OK] Clean zip created successfully!" -ForegroundColor Green
    Write-Host "     Output: $ZipPath"
    Write-Host "     Size: $zipSizeMB MB ($fileCount files)"
    Write-Host ""
    Write-Host "[INFO] Excluded from zip:" -ForegroundColor Gray
    foreach ($pattern in $ExcludePatterns) {
        Write-Host "       - $pattern" -ForegroundColor Gray
    }

} finally {
    # Cleanup temporary directory
    if (Test-Path $TempDir) {
        Remove-Item $TempDir -Recurse -Force
    }
}

Write-Host ""
Write-Host "Done! Share the zip at: $ZipPath" -ForegroundColor Cyan

# Save KB v2 JSON from clipboard
# Run: .\save_kb_v2.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$outputFile = Join-Path $projectRoot "bangladesh_government_services_kb_v2.json"

Write-Host "Saving KB v2 to $outputFile..." -ForegroundColor Cyan

# Get from clipboard
$json = Get-Clipboard -Raw

if (-not $json) {
    Write-Host "ERROR: Clipboard is empty. Please copy the JSON first." -ForegroundColor Red
    exit 1
}

# Validate it's JSON
try {
    $null = $json | ConvertFrom-Json
    Write-Host "✓ Valid JSON detected" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Clipboard content is not valid JSON" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

# Save to file
$json | Out-File -FilePath $outputFile -Encoding UTF8
Write-Host "✓ Saved to $outputFile" -ForegroundColor Green

# Show file size
$size = (Get-Item $outputFile).Length
Write-Host "  File size: $([math]::Round($size/1024, 2)) KB"


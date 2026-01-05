# Script to create GitHub repository and push code
# Requires GitHub Personal Access Token with repo scope
#
# Prerequisites: PortableGit must be in PATH (see GIT_WORKFLOW.md)
# Fallback path: C:\Git\PortableGit\bin\git.exe (for debugging only)

param(
    [Parameter(Mandatory=$false)]
    [string]$GitHubToken,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "infobase-kb",
    
    [Parameter(Mandatory=$false)]
    [string]$Description = "Infobase Knowledge Base"
)

# Try to get token from Windows Credential Manager or git credential helper
if (-not $GitHubToken) {
    Write-Host "Attempting to retrieve GitHub credentials..." -ForegroundColor Yellow
    
    # Try Windows Credential Manager
    try {
        $cred = cmdkey /list | Select-String -Pattern "github"
        if ($cred) {
            Write-Host "Found GitHub credentials in Windows Credential Manager" -ForegroundColor Green
        }
    } catch {}
    
    # Try git credential helper for github.com
    try {
        $credInput = "protocol=https`nhost=github.com`n`n"
        $credOutput = $credInput | git credential fill 2>&1
        if ($credOutput -match "password=(.+)") {
            $GitHubToken = $matches[1].Trim()
            Write-Host "Retrieved credentials from git credential helper" -ForegroundColor Green
        }
    } catch {}
    
    # If still no token, prompt for it
    if (-not $GitHubToken) {
        Write-Host "Could not find stored GitHub credentials." -ForegroundColor Yellow
        $secureToken = Read-Host "Enter your GitHub Personal Access Token" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        $GitHubToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    }
}

$ErrorActionPreference = "Stop"

Write-Host "Creating GitHub repository: $RepoName" -ForegroundColor Green

# Create repository via GitHub API
$headers = @{
    "Authorization" = "token $GitHubToken"
    "Accept" = "application/vnd.github.v3+json"
}

$body = @{
    name = $RepoName
    description = $Description
    private = $true
    auto_init = $false
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body -ContentType "application/json"
    Write-Host "Repository created successfully!" -ForegroundColor Green
    Write-Host "Repository URL: $($response.html_url)" -ForegroundColor Cyan
    
    # Add remote and push
    Write-Host "`nAdding remote origin..." -ForegroundColor Green
    
    git remote remove origin 2>$null
    git remote add origin $response.clone_url
    
    Write-Host "Pushing code to GitHub..." -ForegroundColor Green
    git push -u origin master
    
    Write-Host "`nDone! Repository is available at: $($response.html_url)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "`nMake sure you have a valid GitHub Personal Access Token with 'repo' scope." -ForegroundColor Yellow
    exit 1
}


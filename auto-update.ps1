$ErrorActionPreference = "Stop"

function Run-Step {
  param(
    [string]$Title,
    [string]$Command
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  Write-Host $Command -ForegroundColor DarkGray
  Invoke-Expression $Command
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$currentBranch = (git branch --show-current).Trim()
if (-not $currentBranch) {
  throw "Could not detect the current Git branch."
}

Write-Host "Repository: $repoRoot" -ForegroundColor Green
Write-Host "Current branch: $currentBranch" -ForegroundColor Green

Run-Step "Fetch latest origin state" "git fetch origin"
Run-Step "Rebase current branch on origin/main" "git pull --rebase origin main"
Run-Step "Generate site files" "npm run generate"
Run-Step "Stage generated files" "git add data/site-config.json dist docs generate-meghalaya-jobs.mjs README.md"

$hasStagedChanges = git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "No changes to commit. Working tree is already up to date." -ForegroundColor Yellow
  exit 0
}

Run-Step "Commit changes" 'git commit -m "update Meghalaya jobs sources"'
Run-Step "Push current branch to origin/main" "git push origin HEAD:main"

Write-Host ""
Write-Host "Auto update completed successfully." -ForegroundColor Green

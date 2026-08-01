param(
  [string]$RepoName = "lamina",
  [ValidateSet("private", "public", "internal")]
  [string]$Visibility = "private"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run gh auth login."
}

gh auth status

if (-not (Test-Path ".git")) {
  git init
}

git add .
if (-not (git status --porcelain)) {
  Write-Host "No changes to commit."
} else {
  git commit -m "Initialize Lamina physician directory"
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  gh repo create $RepoName --$Visibility --source . --remote origin --push
} else {
  git push -u origin HEAD
}

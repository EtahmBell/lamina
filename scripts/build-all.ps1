$ErrorActionPreference = "Stop"
$python = ".\.venv\Scripts\python.exe"

& $python -m lamina_directory.download_nppes
& $python -m lamina_directory.download_taxonomy
& $python -m lamina_directory.build_directory `
  --source data/raw/nppes-latest-v2.zip `
  --taxonomy data/raw/nucc-taxonomy.csv `
  --output data/processed/lamina.sqlite

Write-Host "Built the full searchable physician directory."
Write-Host "Run: .\.venv\Scripts\python.exe -m uvicorn api.main:app --reload"

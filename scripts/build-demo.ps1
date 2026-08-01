$ErrorActionPreference = "Stop"
$python = ".\.venv\Scripts\python.exe"

& $python -m lamina_directory.download_nppes
& $python -m lamina_directory.download_taxonomy
& $python -m lamina_directory.build_directory `
  --source data/raw/nppes-latest-v2.zip `
  --taxonomy data/raw/nucc-taxonomy.csv `
  --output data/processed/lamina.sqlite `
  --limit 20000

Write-Host "Built 20,000 searchable physician profiles with reserved inactive agent stubs."
Write-Host "Run: .\.venv\Scripts\python.exe -m uvicorn api.main:app --reload"

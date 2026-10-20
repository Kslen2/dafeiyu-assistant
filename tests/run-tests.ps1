$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Node {
  & node @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Invoke-Node --check (Join-Path $projectRoot "dist\record-parser.js")
Invoke-Node --check (Join-Path $projectRoot "dist\profile-core.js")
Invoke-Node --check (Join-Path $projectRoot "dist\assistant-core.js")
Invoke-Node --check (Join-Path $projectRoot "dist\app.js")
Invoke-Node (Join-Path $PSScriptRoot "record-parser.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "life-scenarios.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "profile-core.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "stress-matrix.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "scale-regression.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "assistant-core.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "assistant-context.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "record-operations.test.cjs")
Invoke-Node (Join-Path $PSScriptRoot "app-integrity.test.cjs")

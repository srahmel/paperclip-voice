param([Parameter(Mandatory)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$venv = Join-Path $RuntimeRoot 'voice-venv'
$model = Join-Path $RuntimeRoot 'voice-models\faster-whisper-small'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    py -3.13 -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
}
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
$previousModel = $env:PAPERCLIP_VOICE_MODEL
try {
    $env:PAPERCLIP_VOICE_MODEL = $model
    & $python -c "import os; from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small', revision='536b0662742c02347bc0e980a01041f333bce120', local_dir=os.environ['PAPERCLIP_VOICE_MODEL'], allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.*'])"
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }
} finally { $env:PAPERCLIP_VOICE_MODEL = $previousModel }
Write-Output "Runtime: $python"
Write-Output "Model: $model"

param([Parameter(Mandatory)][string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$venv = Join-Path $RuntimeRoot 'tts-venv'
$models = Join-Path $RuntimeRoot 'voice-models\piper'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    py -3.13 -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'TTS virtual environment creation failed.' }
}
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements-tts.txt')
if ($LASTEXITCODE -ne 0) { throw 'TTS dependency installation failed.' }
$revision = 'b4e358ffcb232591bf73a540e70f7de528e4174a'
$files = @(
    'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
    'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json',
    'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'
)
foreach ($relative in $files) {
    $destination = Join-Path $models $relative
    if (-not (Test-Path -LiteralPath $destination)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        $temporary = "$destination.part"
        try {
            Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/$revision/$relative" -OutFile $temporary
            Move-Item -LiteralPath $temporary -Destination $destination
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
}
Write-Output "TTS runtime: $python"
Write-Output "TTS models: $models"

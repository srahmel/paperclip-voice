[CmdletBinding()]
param(
    [string]$RuntimeRoot,
    [string]$VoiceRoot,
    [string]$StateRoot,
    [string]$SnapshotRoot,
    [switch]$Force,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:VoiceAssets = @(
    @{ Path='voice-models/faster-whisper-small/config.json'; Sha='B55496AC7940A7AE47D2C01EAB40EDFD8701FEEC1229D9CCE3B40014383FB828'; Url='https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/config.json' },
    @{ Path='voice-models/faster-whisper-small/model.bin'; Sha='3E305921506D8872816023E4C273E75D2419FB89B24DA97B4FE7BCE14170D671'; Url='https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/model.bin' },
    @{ Path='voice-models/faster-whisper-small/tokenizer.json'; Sha='FB7B63191E9BB045082C79FD742A3106A12C99513AB30DF4A0D47FA6CB6FD0AB'; Url='https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/tokenizer.json' },
    @{ Path='voice-models/faster-whisper-small/vocabulary.txt'; Sha='34CE3FE1C5041027B3F8D42912270993F986DBC4BB34CF27F951E34A1E453913'; Url='https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/vocabulary.txt' },
    @{ Path='voice-models/piper/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx'; Sha='7E64762D8E5118BB578F2EEA6207E1A35A8E0C30595010B666F983FC87BB7819'; Url='https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx' },
    @{ Path='voice-models/piper/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json'; Sha='974ADEE790533ADB273A1AC88F49027D2A1B8F0F2CF4905954A4791E79264E85'; Url='https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json' },
    @{ Path='voice-models/piper/en/en_US/lessac/medium/en_US-lessac-medium.onnx'; Sha='5EFE09E69902187827AF646E1A6E9D269DEE769F9877D17B16B1B46EEAAF019F'; Url='https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/en/en_US/lessac/medium/en_US-lessac-medium.onnx' },
    @{ Path='voice-models/piper/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'; Sha='EFE19C417BED055F2D69908248C6BA650FA135BC868B0E6ABB3DA181DAB690A0'; Url='https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json' }
)

function Write-VoiceEvent([string]$Message) {
    $log = Join-Path $StateRoot 'voice-runtime-repair.log'
    Add-Content -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

function Restore-MissingWorker([string]$Name) {
    $source = Join-Path $SnapshotRoot $Name
    $destination = Join-Path $VoiceRoot $Name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'worker snapshot missing' }
    if (-not (Test-Path -LiteralPath $destination)) {
        New-Item -ItemType Directory -Force -Path $VoiceRoot | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
        Write-VoiceEvent "Fehlende Voice-Datei wiederhergestellt: $Name"
    }
    # Existing files, including local modifications, are never overwritten.
}

function Install-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha) {
    if ($Offline) { throw 'network disabled' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    $temporary = "$Destination.part-$PID"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $temporary -TimeoutSec 300
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Sha) { throw 'download checksum mismatch' }
        if (Test-Path -LiteralPath $Destination) {
            $quarantine = "$Destination.invalid-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))-$PID"
            Move-Item -LiteralPath $Destination -Destination $quarantine
        }
        Move-Item -LiteralPath $temporary -Destination $Destination
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Get-PortablePython {
    $base = Join-Path $RuntimeRoot 'python-3.13.9\tools\python.exe'
    if (Test-Path -LiteralPath $base -PathType Leaf) {
        & $base -c 'import sys; assert sys.version_info[:2] == (3,13)' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return $base }
        throw 'portable python is damaged'
    }
    $package = Join-Path $RuntimeRoot 'python-3.13.9.nupkg'
    $expected = 'EA7541C98F77B6F344460B88DB6E677573069979BCBF0BA18747CC2C125ABA25'
    if (-not (Test-Path -LiteralPath $package) -or (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expected) {
        Install-VerifiedFile 'https://www.nuget.org/api/v2/package/python/3.13.9' $package $expected
    }
    $zip = Join-Path $RuntimeRoot "python-extract-$PID.zip"
    $stage = Join-Path $RuntimeRoot "python-extract-$PID"
    Copy-Item -LiteralPath $package -Destination $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $stage
    $target = Join-Path $RuntimeRoot 'python-3.13.9'
    if (Test-Path -LiteralPath $target) { throw 'portable python target already exists' }
    Move-Item -LiteralPath $stage -Destination $target
    if (-not (Test-Path -LiteralPath $base -PathType Leaf)) { throw 'portable python missing' }
    & $base -c 'import sys; assert sys.version_info[:2] == (3,13)' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'portable python failed' }
    return $base
}

function Test-Venv([string]$Python, [string]$Kind, [string]$Requirements) {
    if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { return $false }
    $probe = if ($Kind -eq 'stt') {
        'import sys, importlib.metadata as m; from pathlib import Path; import faster_whisper, ctranslate2, av; assert sys.version_info[:2] == (3,13); assert all(m.version(n)==v for n,v in (line.split("==",1) for line in Path(sys.argv[1]).read_text().splitlines() if line and not line.startswith("#")))'
    } else {
        'import sys, importlib.metadata as m; from pathlib import Path; import piper, onnxruntime; assert sys.version_info[:2] == (3,13); assert all(m.version(n)==v for n,v in (line.split("==",1) for line in Path(sys.argv[1]).read_text().splitlines() if line and not line.startswith("#")))'
    }
    try { & $Python -c $probe (Join-Path $SnapshotRoot $Requirements) 2>$null | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

function Repair-Venv([string]$Name, [string]$Kind, [string]$Requirements) {
    $root = Join-Path $RuntimeRoot $Name
    $python = Join-Path $root 'Scripts\python.exe'
    if (Test-Venv $python $Kind $Requirements) { return }
    Write-VoiceEvent "Voice-Laufzeit $Kind fehlt oder ist unvollständig; Reparatur gestartet."
    $base = Get-PortablePython
    & $base -m venv $root *> $null
    if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
    if ($Offline) { throw 'network disabled' }
    # Avoid user pip index settings or credentials being written to logs.
    $env:PIP_CONFIG_FILE = 'NUL'
    $env:PIP_INDEX_URL = 'https://pypi.org/simple'
    $env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
    foreach ($name in @('PIP_EXTRA_INDEX_URL','PIP_FIND_LINKS','PIP_TRUSTED_HOST','PIP_NO_INDEX','PIP_CONSTRAINT','PIP_REQUIRE_HASHES','PIP_PROXY')) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    & $python -m pip install --no-input --retries 2 --timeout 30 --force-reinstall -r (Join-Path $SnapshotRoot $Requirements) *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Venv $python $Kind $Requirements)) { throw 'dependency installation failed' }
    Write-VoiceEvent "Voice-Laufzeit $Kind ist wieder verfügbar."
}

function Invoke-VoiceRepair {
    $fromRepo = (Split-Path -Leaf $PSScriptRoot) -eq 'dictation'
    $workspace = if ($fromRepo) { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) } else { Split-Path -Parent $PSScriptRoot }
    if (-not $RuntimeRoot) { $script:RuntimeRoot = Join-Path $workspace '.paperclip-runtime' }
    if (-not $VoiceRoot) { $script:VoiceRoot = if ($fromRepo) { $PSScriptRoot } else { Join-Path $workspace 'paperclip-voice\dictation' } }
    if (-not $StateRoot) { $script:StateRoot = if ($fromRepo) { Join-Path $RuntimeRoot 'voice-maintenance' } else { Join-Path $PSScriptRoot 'state' } }
    if (-not $SnapshotRoot) { $script:SnapshotRoot = if ($fromRepo) { $PSScriptRoot } else { Join-Path $PSScriptRoot 'voice-runtime' } }
    New-Item -ItemType Directory -Force -Path $RuntimeRoot, $StateRoot | Out-Null
    $mutex = [Threading.Mutex]::new($false, 'Local\PaperclipVoiceRuntimeRepair')
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { return }
        $failure = Join-Path $StateRoot 'voice-runtime-last-failure.txt'
        if (-not $Force -and (Test-Path -LiteralPath $failure) -and ((Get-Date) - (Get-Item -LiteralPath $failure).LastWriteTime).TotalMinutes -lt 30) { return }
        $phase = 'Worker-Dateien'
        try {
            foreach ($name in @('transcribe.py','synthesize.py','requirements.txt','requirements-tts.txt')) { Restore-MissingWorker $name }
            foreach ($entry in $script:VoiceAssets) {
                $phase = "Modell $($entry.Path)"
                $path = Join-Path $RuntimeRoot $entry.Path
                # A cached hash is valid only while size and modification time are unchanged.
                $cacheFile = Join-Path $StateRoot 'voice-runtime-model-hashes.json'
                if (-not $script:VoiceHashCache) {
                    $script:VoiceHashCache = @{}
                    if (Test-Path -LiteralPath $cacheFile) {
                        try { $stored = Get-Content -LiteralPath $cacheFile -Raw | ConvertFrom-Json -AsHashtable; if ($stored -is [System.Collections.IDictionary]) { $script:VoiceHashCache = $stored } } catch { }
                    }
                }
                $valid = $false
                if (Test-Path -LiteralPath $path -PathType Leaf) {
                    $item = Get-Item -LiteralPath $path
                    $cached = $script:VoiceHashCache[$entry.Path]
                    if ($cached -and $cached.size -eq $item.Length -and $cached.ticks -eq $item.LastWriteTimeUtc.Ticks -and $cached.sha -eq $entry.Sha) { $valid = $true }
                    elseif ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $entry.Sha) { $valid = $true }
                }
                if (-not $valid) {
                    Write-VoiceEvent 'Ein Voice-Modell fehlt oder ist beschädigt; Wiederherstellung gestartet.'
                    Install-VerifiedFile $entry.Url $path $entry.Sha
                    Write-VoiceEvent 'Ein Voice-Modell wurde wiederhergestellt und geprüft.'
                }
                $item = Get-Item -LiteralPath $path
                $script:VoiceHashCache[$entry.Path] = @{ size=$item.Length; ticks=$item.LastWriteTimeUtc.Ticks; sha=$entry.Sha }
            }
            $script:VoiceHashCache | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $StateRoot 'voice-runtime-model-hashes.json')
            $phase = 'Whisper-Laufzeit'
            Repair-Venv 'voice-venv' 'stt' 'requirements.txt'
            $phase = 'Piper-Laufzeit'
            Repair-Venv 'tts-venv' 'tts' 'requirements-tts.txt'
            if (Test-Path -LiteralPath $failure) { Remove-Item -LiteralPath $failure -Force }
            Write-Output 'Voice runtime ready.'
        } catch {
            Set-Content -LiteralPath $failure -Value ([DateTime]::UtcNow.ToString('o')) -NoNewline
            Write-VoiceEvent "Voice-Reparatur fehlgeschlagen bei ${phase}; nächster Versuch frühestens in 30 Minuten. Paperclip bleibt verfügbar."
            Write-Output 'Voice runtime repair failed; see local status log.'
            exit 1
        }
    } finally { if ($owned) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-VoiceRepair }

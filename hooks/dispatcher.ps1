<#
.SYNOPSIS
  UnionCodePet dispatcher — the single script every CLI hook/notify calls.

.DESCRIPTION
  Instead of each CLI playing its own sound, every CLI's hook/notify invokes
  THIS script. It reads the event payload (from stdin for Claude/Zcode hooks,
  from the argv for Codex notify), wraps it in a small JSON envelope, and POSTs
  it to the local daemon at http://127.0.0.1:23333/event. The daemon then owns
  sound + state + panel.

  Invocation shapes:
    Claude Code hook (payload on stdin):
        powershell -File dispatcher.ps1 -Source claude -Kind Stop
    Zcode hook (payload on stdin):
        powershell -File dispatcher.ps1 -Source zcode
    Codex notify (payload as argv string):
        powershell -File dispatcher.ps1 -Source codex -JsonPayload '<json>'

.NOTES
  Reading stdin on Windows PowerShell is finicky:
  - When stdin is piped, PowerShell tries to bind it to param() pipeline params.
    This script has NO pipeline-bound params, so binding fails with a noisy
    `InputObjectNotBound` error — harmless but ugly, and the object is still
    available via the automatic `$input` variable. We harvest `$input` first.
  - `[Console]::In.ReadToEnd()` is the fallback for the non-piped stream case.
  - If the daemon is down, this script exits 0 silently — the CLI must not be
    punished for the daemon being offline.
#>
param(
    [string]$Source,
    [string]$Kind,
    # Codex passes its payload as a single JSON string argument.
    [string]$JsonPayload,
    [string]$DaemonUrl = 'http://127.0.0.1:23333/event'
)

# Run the whole body in a way that swallows the stray pipeline-binding noise:
# wrapping in a script block + call operator keeps the noisy error from leaking
# while still letting us read $input.
$ErrorActionPreference = 'SilentlyContinue'

# Force UTF-8 for stdin/stdout. PowerShell 5.1 defaults to the system codepage
# (GBK on Chinese Windows, chcp 936). This helps keep ASCII fields clean; note
# that Chinese text in Zcode payloads may still arrive corrupted, in which case
# the daemon's regex fallback (see daemon.ts parsePayload) recovers the ASCII
# state fields so sound + status still work — the panel summary just shows the
# generic label instead of the dynamic Chinese text.
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

# --- Resolve -Source from $args if param binding dropped it ----------------
# When stdin is piped, positional param binding can be skipped/interfered with.
# Claude/Zcode always pass -Source explicitly, so this is a belt-and-suspenders.
if (-not $Source -and $args) {
    foreach ($a in $args) {
        if ($a -is [string] -and $a -in @('claude', 'zcode', 'codex')) { $Source = $a }
    }
}
if (-not $Source) { $Source = 'claude' }

# --- Gather payload (ALWAYS keep it as a raw string) ----------------------
# We deliberately do NOT ConvertFrom-Json here. Re-parsing + ConvertTo-Json of
# a nested PSCustomObject silently corrupts the shape on some PowerShell builds
# (props dropped, payload becomes null), which is exactly why Codex events
# never reached the daemon. Instead we forward the raw JSON string and let the
# daemon's JSON.parse be the single source of truth.

$rawPayload = $null
$sessionId = $null

# Prefer the UCP_PAYLOAD env var (set by notify.ps1) over the -JsonPayload arg:
# passing JSON via argv mangles embedded quotes in PowerShell's command-line
# parsing, corrupting the payload. The env var round-trips the raw bytes intact.
if ($env:UCP_PAYLOAD) {
    $rawPayload = $env:UCP_PAYLOAD
} elseif ($JsonPayload) {
    # Fallback: direct -JsonPayload arg (quotes may be mangled, but keep it).
    $rawPayload = $JsonPayload
} else {
    # Claude/Zcode hook path: payload arrives via stdin. Try BOTH channels:
    #  1) $input automatic variable — populated when PowerShell bound the piped
    #     stdin as objects (the common case for hook invocation).
    #  2) [Console]::In.ReadToEnd() — the raw stream, for non-piped callers.
    try {
        $fromInput = @($input)            # force-enumerate; survives empty/null
        if ($fromInput -and $fromInput.Count -gt 0) {
            $rawPayload = ($fromInput | Out-String)
        }
    } catch { }
    if ([string]::IsNullOrWhiteSpace($rawPayload)) {
        try { $rawPayload = [Console]::In.ReadToEnd() } catch { }
    }
}

# Mine sessionId out of the raw JSON with a cheap regex (no full parse needed).
if ($rawPayload -match '"sessionId"\s*:\s*"([^"]*)"') { $sessionId = $Matches[1] }
elseif ($rawPayload -match '"thread-id"\s*:\s*"([^"]*)"') { $sessionId = $Matches[1] }

# --- Build the envelope ---------------------------------------------------
# Send payload as a STRING (the raw JSON text), NOT a nested object. Hand-
# concatenating JSON mangles embedded quotes; a flat hashtable where `payload`
# is a plain string serializes reliably (daemon's parsePayload re-JSON.parses).
#
# Truncate oversized payloads: Zcode's Stop event includes the FULL agent reply
# in responsePreview; under GBK that balloons the body and the POST times out
# before it finishes sending. The daemon only shows a short summary anyway, so
# cap well below the point where transfer becomes slow.
if ($rawPayload -and $rawPayload.Length -gt 2000) {
    $rawPayload = $rawPayload.Substring(0, 2000)
}
if ($rawPayload) { $rawPayload = $rawPayload.Trim() }

$envelope = [ordered]@{
    source    = $Source
    kind      = $Kind
    payload   = if ($rawPayload) { $rawPayload } else { $null }
    sessionId = $sessionId
}
$body = $envelope | ConvertTo-Json -Compress

# --- Fire-and-forget POST -------------------------------------------------
try {
    $req = [System.Net.HttpWebRequest]::Create($DaemonUrl)
    $req.Method = 'POST'
    $req.ContentType = 'application/json; charset=utf-8'
    $req.Timeout = 5000        # ms — was 1500, too short for big Zcode payloads
    $req.ReadWriteTimeout = 5000
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    $resp.Close()
} catch {
    # Daemon down or timeout: exit silently so the CLI keeps working.
    exit 0
}

exit 0

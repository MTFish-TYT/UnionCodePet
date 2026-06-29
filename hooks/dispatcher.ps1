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

# --- Resolve -Source from $args if param binding dropped it ----------------
# When stdin is piped, positional param binding can be skipped/interfered with.
# Claude/Zcode always pass -Source explicitly, so this is a belt-and-suspenders.
if (-not $Source -and $args) {
    foreach ($a in $args) {
        if ($a -is [string] -and $a -in @('claude', 'zcode', 'codex')) { $Source = $a }
    }
}
if (-not $Source) { $Source = 'claude' }

# --- Gather payload -------------------------------------------------------
$payload = $null

if ($JsonPayload) {
    # Codex notify path: payload already in hand.
    try { $payload = $JsonPayload | ConvertFrom-Json } catch { }
} else {
    # Claude/Zcode hook path: payload arrives via stdin. Try BOTH channels:
    #  1) $input automatic variable — populated when PowerShell bound the piped
    #     stdin as objects (the common case for hook invocation).
    #  2) [Console]::In.ReadToEnd() — the raw stream, for non-piped callers.
    $raw = ''
    try {
        $fromInput = @($input)            # force-enumerate; survives empty/null
        if ($fromInput -and $fromInput.Count -gt 0) {
            $raw = ($fromInput | Out-String)
        }
    } catch { }
    if ([string]::IsNullOrWhiteSpace($raw)) {
        try { $raw = [Console]::In.ReadToEnd() } catch { }
    }
    if ($raw) {
        try { $payload = $raw | ConvertFrom-Json } catch { }
    }
}

# --- Build the envelope ---------------------------------------------------
$envelope = [ordered]@{
    source    = $Source
    kind      = $Kind
    payload   = $payload
    sessionId = if ($payload.sessionId) { $payload.sessionId }
                elseif ($payload.'thread-id') { $payload.'thread-id' }
                else { $null }
}
$body = $envelope | ConvertTo-Json -Depth 20 -Compress

# --- Fire-and-forget POST -------------------------------------------------
try {
    $req = [System.Net.HttpWebRequest]::Create($DaemonUrl)
    $req.Method = 'POST'
    $req.ContentType = 'application/json; charset=utf-8'
    $req.Timeout = 1500        # ms — never block the CLI
    $req.ReadWriteTimeout = 1500
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

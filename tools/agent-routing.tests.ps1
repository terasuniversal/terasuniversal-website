$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-routing-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot
    $AiDir = $tempRoot
    . (Join-Path $PSScriptRoot "agent-router.ps1")

    function Assert-Route {
        param($Classification, [string]$Risk, [string]$Description)
        if ($Classification.Implementer -ne "Codex") { throw "$Description implementer was $($Classification.Implementer)" }
        if ($Classification.ImplementerModel -ne "CODEX") { throw "$Description model was $($Classification.ImplementerModel)" }
        if ($Classification.Risk -ne $Risk) { throw "$Description risk was $($Classification.Risk), expected $Risk" }
    }

    Assert-Route (Get-TaskClassification -MenuChoice 3 -Description "Fix admin spacing") "LOW" "LOW"
    Assert-Route (Get-TaskClassification -MenuChoice 1 -Description "Add a CRM report") "MEDIUM" "MEDIUM"
    Assert-Route (Get-TaskClassification -MenuChoice 4 -Description "Create Supabase RLS policy") "HIGH" "HIGH"
    Assert-Route (Get-TaskClassification -MenuChoice 4 -Description "Drop production table") "CRITICAL" "CRITICAL"

    $high = Get-TaskClassification -MenuChoice 4 -Description "Create Supabase RLS policy"
    if ($high.Reviewer -ne "Claude Code" -or $high.ReviewerModel -ne "CLAUDE_REVIEW") { throw "HIGH review route is not Claude Code." }
    $critical = Get-TaskClassification -MenuChoice 4 -Description "Drop production table"
    if ($critical.Reviewer -ne "Claude Code" -or $critical.ReviewerModel -ne "CLAUDE_REVIEW") { throw "CRITICAL review route is not Claude Code." }
    foreach ($classification in @(
        (Get-TaskClassification -MenuChoice 3 -Description "Fix admin spacing"),
        (Get-TaskClassification -MenuChoice 1 -Description "Add a CRM report"),
        $high,
        $critical
    )) {
        $reason = [string]$classification.Reason
        if ($reason -match 'DeepSeek is enabled|Claude FAST is the default|Claude DEEP \+ mandatory Codex review') {
            throw "Route reason contains stale implementer guidance: $reason"
        }
    }

    $audit = Get-TaskClassification -MenuChoice 7 -Description "Read-only production audit"
    if ($audit.Implementer -ne "Codex" -or $audit.Reviewer -ne "Human") { throw "Production audit route changed unexpectedly." }

    $routerSource = Get-Content (Join-Path $PSScriptRoot "agent-router.ps1") -Raw
    $agentSource = Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw
    if ($routerSource -match '\[switch\]\$PreferDeepSeek|Implementer = "DeepSeek"') { throw "DeepSeek routing remains reachable in agent-router.ps1." }
    if ($agentSource -match '\[switch\]\$(TestDeepSeek|DeepSeekStatus|PreferDeepSeek)|Invoke-DeepSeekImplementation\s+-HandoffPath|Invoke-DeepSeekPostCallResult\s+-State') { throw "DeepSeek invocation or CLI parameter remains reachable in teras-agent.ps1." }
    if ($routerSource -notmatch 'DeepSeek is disabled; use Get-PrimaryImplementerChoice' -or $agentSource -notmatch 'DeepSeek is disabled; no DeepSeek fallback is supported') { throw "Disabled DeepSeek guard assertions failed." }

    Write-Output "Agent routing tests: PASS"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

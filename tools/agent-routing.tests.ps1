$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-routing-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot
    $AiDir = $tempRoot
    . (Join-Path $PSScriptRoot "agent-router.ps1")

    function Set-DeepSeekHealthStub {
        param([bool]$Healthy)

        $script:DeepSeekHealthStubHealthy = $Healthy
        function global:Test-DeepSeekDefaultImplementerEnabled { return $true }
        function global:Test-DeepSeekHealthyForRouting { return $script:DeepSeekHealthStubHealthy }
    }

    function Assert-Route {
        param($Classification, [string]$Risk, [string]$Description)
        if ($Classification.Implementer -ne "Codex") { throw "$Description implementer was $($Classification.Implementer)" }
        if ($Classification.ImplementerModel -ne "CODEX") { throw "$Description model was $($Classification.ImplementerModel)" }
        if ($Classification.Risk -ne $Risk) { throw "$Description risk was $($Classification.Risk), expected $Risk" }
    }

    Set-DeepSeekHealthStub -Healthy $true
    $auditHealthy = Get-TaskClassification -MenuChoice 1 -Description "Read-only audit of the CRM routing"
    if ($auditHealthy.Implementer -ne "DeepSeek" -or
        $auditHealthy.ImplementerModel -ne "DEEPSEEK_FAST" -or
        $auditHealthy.Reviewer -ne "None" -or
        $auditHealthy.ReviewerModel -ne "None") {
        throw "Healthy Audit/Research/Scout route was not DeepSeek / DEEPSEEK_FAST without review."
    }

    Set-DeepSeekHealthStub -Healthy $false
    $auditFallback = Get-TaskClassification -MenuChoice 1 -Description "Read-only audit of the CRM routing"
    if ($auditFallback.Implementer -ne "Codex" -or $auditFallback.ImplementerModel -ne "CODEX") {
        throw "Unavailable DeepSeek did not fall back to Codex for Audit/Research/Scout."
    }
    if ($auditFallback.Reason -notmatch "DeepSeek was unavailable.*Codex fallback") {
        throw "DeepSeek fallback reason was not recorded: $($auditFallback.Reason)"
    }

    $normal = Get-TaskClassification -MenuChoice 1 -Description "Add a CRM report"
    Assert-Route $normal "MEDIUM" "Normal development"
    if ($normal.Implementer -ne "Codex" -or $normal.ImplementerModel -ne "CODEX") {
        throw "Normal Feature MEDIUM route was not Codex."
    }

    $high = Get-TaskClassification -MenuChoice 4 -Description "Create Supabase RLS policy"
    Assert-Route $high "HIGH" "HIGH"
    if ($high.Implementer -ne "Codex" -or $high.ImplementerModel -ne "CODEX" -or
        $high.Reviewer -ne "Claude Code" -or $high.ReviewerModel -ne "CLAUDE_REVIEW" -or
        $high.HumanApproval -ne "REQUIRED") {
        throw "HIGH Database/Supabase route is not Codex + Claude + human approval."
    }

    $critical = Get-TaskClassification -MenuChoice 4 -Description "Drop production table"
    Assert-Route $critical "CRITICAL" "CRITICAL"
    if ($critical.Implementer -ne "Codex" -or $critical.ImplementerModel -ne "CODEX" -or
        $critical.Reviewer -ne "Claude Code" -or $critical.ReviewerModel -ne "CLAUDE_REVIEW" -or
        $critical.HumanApproval -ne "REQUIRED") {
        throw "CRITICAL route is not Codex + Claude independent review + human approval."
    }

    foreach ($classification in @($auditHealthy, $auditFallback, $normal, $high, $critical)) {
        $reason = [string]$classification.Reason
        if ($reason -match 'Claude FAST is the default|Claude DEEP \+ mandatory Codex review') {
            throw "Route reason contains stale implementer guidance: $reason"
        }
    }

    $routerSource = Get-Content (Join-Path $PSScriptRoot "agent-router.ps1") -Raw
    if ($routerSource -notmatch 'Implementer = "DeepSeek"' -or
        $routerSource -notmatch 'ImplementerModel = "DEEPSEEK_FAST"' -or
        $routerSource -notmatch 'DeepSeek was unavailable, so Codex fallback was selected') {
        throw "Approved DeepSeek healthy/fallback routing is not represented in agent-router.ps1."
    }
    if ($routerSource -notmatch 'Claude independent review; tests/E2E') {
        throw "CRITICAL QA/E2E gate is not represented in the router task requirements."
    }

    Write-Output "Agent routing tests: PASS"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

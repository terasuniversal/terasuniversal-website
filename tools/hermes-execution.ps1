<##
    Hermes cross-process execution lease, heartbeat, lock, and journal.

    This file is runtime-local tooling only. It never executes arbitrary shell
    input: callers provide a fixed executable name and bounded argument array.
##>

function Get-HermesExecutionKey {
    param([string]$TaskId)
    if ([string]::IsNullOrWhiteSpace($TaskId)) { throw "A task ID is required for execution ownership." }
    return (($TaskId -replace '[^A-Za-z0-9._-]', '_').Substring(0, [Math]::Min(96, ($TaskId -replace '[^A-Za-z0-9._-]', '_').Length)))
}

function Get-HermesExecutionDirectory {
    return (Join-Path $AiDir "hermes-execution")
}

function Get-HermesExecutionLeasePath {
    param([string]$TaskId)
    return (Join-Path (Get-HermesExecutionDirectory) "$(Get-HermesExecutionKey -TaskId $TaskId).lease.json")
}

function Get-HermesExecutionLockPath {
    param([string]$TaskId)
    return (Join-Path (Get-HermesExecutionDirectory) "$(Get-HermesExecutionKey -TaskId $TaskId).lock")
}

function Get-HermesExecutionJournalPath {
    param([string]$TaskId)
    return (Join-Path (Get-HermesExecutionDirectory) "$(Get-HermesExecutionKey -TaskId $TaskId).journal.jsonl")
}

function Get-HermesDecisionPath {
    param([string]$TaskId)
    return (Join-Path (Join-Path $AiDir "hermes-decisions") "$(Get-HermesExecutionKey -TaskId $TaskId).json")
}

function Test-HermesDecisionEligibility {
    param($State, [string]$Workspace = $RepoRoot)
    $path = Get-HermesDecisionPath -TaskId $State.TaskId
    if (-not (Test-Path -LiteralPath $path)) { return [pscustomobject]@{ Allowed = $false; Code = "DECISION_MISSING"; Reason = "No durable H4 ALLOW decision exists for this task." } }
    try { $decision = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json } catch { return [pscustomobject]@{ Allowed = $false; Code = "DECISION_INVALID"; Reason = "The durable H4 decision record is unreadable." } }
    if ($decision.Decision -ne "ALLOW" -or $decision.LeaseEligible -ne $true) { return [pscustomobject]@{ Allowed = $false; Code = "LEASE_NOT_ELIGIBLE"; Reason = "The H4 decision is not ALLOW and lease eligible." } }
    if ($decision.TaskId -and $decision.TaskId -ne $State.TaskId) { return [pscustomobject]@{ Allowed = $false; Code = "WORKSPACE_MISMATCH"; Reason = "Decision task identity does not match the execution task." } }
    try { if ([datetime]::Parse([string]$decision.ExpiresAt).ToUniversalTime() -le [datetime]::UtcNow) { return [pscustomobject]@{ Allowed = $false; Code = "STALE_DECISION"; Reason = "The H4 decision has expired." } } } catch { return [pscustomobject]@{ Allowed = $false; Code = "STALE_DECISION"; Reason = "The H4 decision expiry is invalid." } }
    $normalize = { param($v) ([string]$v -replace '/', '').TrimEnd('').ToLowerInvariant() }
    if ((& $normalize $decision.Workspace) -ne (& $normalize $Workspace)) { return [pscustomobject]@{ Allowed = $false; Code = "WORKSPACE_MISMATCH"; Reason = "Decision workspace differs from the execution workspace." } }
    $branch = (git -C $Workspace branch --show-current 2>$null | Select-Object -First 1).Trim()
    $head = (git -C $Workspace rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    $status = @(git -C $Workspace status --porcelain --untracked-files=all -- . ':(exclude).ai/hermes-decisions/**' ':(exclude).ai/hermes-execution/**' 2>$null)
    $bytes = [Text.Encoding]::UTF8.GetBytes(($status -join "`n"))
    $fingerprint = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))) -replace '-', '').ToLowerInvariant()
    if ($decision.Branch -and $decision.Branch -ne $branch) { return [pscustomobject]@{ Allowed = $false; Code = "BRANCH_MISMATCH"; Reason = "Branch changed after the H4 decision." } }
    if ($decision.ObservedHeadSha -and $decision.ObservedHeadSha -ne $head) { return [pscustomobject]@{ Allowed = $false; Code = "HEAD_DRIFT"; Reason = "HEAD changed after the H4 decision." } }
    if ($decision.StatusFingerprint -and $decision.StatusFingerprint -ne $fingerprint) { return [pscustomobject]@{ Allowed = $false; Code = "STATUS_FINGERPRINT_DRIFT"; Reason = "Working-tree status changed after the H4 decision." } }
    if ($decision.ImplementerProvider -and $decision.ImplementerProvider -ne $State.ImplementerProvider) { return [pscustomobject]@{ Allowed = $false; Code = "MODEL_UNAVAILABLE"; Reason = "Decision provider does not match the routed task." } }
    if ($decision.ImplementerModel -and $decision.ImplementerModel -ne $State.ImplementerModel) { return [pscustomobject]@{ Allowed = $false; Code = "MODEL_UNAVAILABLE"; Reason = "Decision model does not match the routed task." } }
    return [pscustomobject]@{ Allowed = $true; Code = $null; Reason = "H4 decision is current and lease eligible."; Decision = $decision }
}

function Write-HermesAtomicJson {
    param([string]$Path, $Value)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temporary = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $temporary -Encoding utf8
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Add-HermesExecutionJournalEvent {
    param([string]$TaskId, [string]$Event, $Lease, [string]$Details = "")
    $record = [ordered]@{
        timestamp = [DateTime]::UtcNow.ToString("o")
        event = $Event
        taskId = $TaskId
        executionId = $Lease.executionId
        attempt = $Lease.attempt
        status = $Lease.status
        details = $Details
    }
    Add-Content -LiteralPath (Get-HermesExecutionJournalPath -TaskId $TaskId) -Value ($record | ConvertTo-Json -Compress -Depth 8) -Encoding utf8
}

function Get-HermesExecutionLease {
    param([string]$TaskId)
    $path = Get-HermesExecutionLeasePath -TaskId $TaskId
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return (Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json) } catch { return $null }
}

function Test-HermesLeaseFresh {
    param($Lease, [datetime]$Now = [datetime]::UtcNow)
    if (-not $Lease) { return $false }
    if ($Lease.status -notin @("RUNNING", "STARTING")) { return $false }
    try {
        $expires = [datetime]::Parse([string]$Lease.leaseExpiresAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        $heartbeat = [datetime]::Parse([string]$Lease.heartbeatAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        return ($expires.ToUniversalTime() -gt $Now.ToUniversalTime() -and $heartbeat.ToUniversalTime() -le $Now.ToUniversalTime())
    } catch { return $false }
}

function Acquire-HermesExecutionLease {
    param(
        $State,
        [string]$Agent,
        [string]$Provider,
        [string]$Model,
        [string]$Workspace = $RepoRoot,
        [int]$TtlSeconds = 30,
        [int]$ProcessId = $PID,
        [string]$ExecutionId = $null,
        [switch]$RequireDecision
    )

    Repair-TaskStateSchema -State $State | Out-Null
    if ($RequireDecision) {
        $decisionCheck = Test-HermesDecisionEligibility -State $State -Workspace $Workspace
        if (-not $decisionCheck.Allowed) { return [pscustomobject]@{ acquired = $false; status = "DECISION_BLOCKED"; code = $decisionCheck.Code; reason = $decisionCheck.Reason } }
    }
    $expected = [string]$State.WorkspaceBoundary.CanonicalWorkspace
    $normalize = { param($v) ([string]$v -replace '/', '\').TrimEnd('\').ToLowerInvariant() }
    if ($expected -and (& $normalize $expected) -ne (& $normalize $Workspace)) {
        return [pscustomobject]@{ acquired = $false; status = "WORKSPACE_BLOCKED"; reason = "Persisted task workspace does not match the intended Hermes worktree." }
    }
    if ($State.State -in @("COMPLETED", "CANCELLED", "FAILED")) {
        return [pscustomobject]@{ acquired = $false; status = "TERMINAL"; reason = "Terminal tasks cannot acquire a new execution lease." }
    }
    if ($State.Risk -in @("HIGH", "CRITICAL") -and $State.HumanApprovalRequired -eq "REQUIRED" -and $State.HumanDecision -ne "APPROVED") {
        return [pscustomobject]@{ acquired = $false; status = "APPROVAL_REQUIRED"; reason = "Human approval is required before lease acquisition." }
    }

    $directory = Get-HermesExecutionDirectory
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $lockPath = Get-HermesExecutionLockPath -TaskId $State.TaskId
    $existingLease = Get-HermesExecutionLease -TaskId $State.TaskId
    if (Test-HermesLeaseFresh -Lease $existingLease) {
        return [pscustomobject]@{ acquired = $false; status = "ALREADY_RUNNING"; reason = "A valid execution lease already owns this task."; executionId = $existingLease.executionId }
    }

    $lockStream = $null
    try {
        for ($lockAttempt = 0; $lockAttempt -lt 2 -and -not $lockStream; $lockAttempt++) {
            try {
                $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            } catch [IO.IOException] {
                if ($lockAttempt -eq 0 -and $existingLease -and -not (Test-HermesLeaseFresh -Lease $existingLease)) {
                    try {
                        $probe = [IO.File]::Open($lockPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
                        $probe.Dispose()
                        Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
                        continue
                    } catch {
                        return [pscustomobject]@{ acquired = $false; status = "EXECUTION_LOCKED"; reason = "A stale-looking lock is still owned by a live process." }
                    }
                }
                return [pscustomobject]@{ acquired = $false; status = "EXECUTION_LOCKED"; reason = "Another Hermes process owns the execution lock." }
            }
        }
        if (-not $lockStream) { return [pscustomobject]@{ acquired = $false; status = "EXECUTION_LOCKED"; reason = "Execution lock acquisition timed out." } }

        $now = [datetime]::UtcNow
        if ($existingLease -and (Test-HermesLeaseFresh -Lease $existingLease -Now $now)) {
            $lockStream.Dispose()
            return [pscustomobject]@{ acquired = $false; status = "ALREADY_RUNNING"; reason = "A valid execution lease already owns this task."; executionId = $existingLease.executionId }
        }
        $id = if ($ExecutionId) { $ExecutionId } else { "exec-$([guid]::NewGuid().ToString('N'))" }
        $attempt = [int]$State.ExecutionAttempt + 1
        $lease = [pscustomobject]@{
            taskId = $State.TaskId
            executionId = $id
            agent = $Agent
            provider = $Provider
            model = $Model
            processId = $ProcessId
            processToken = "$ProcessId-$([guid]::NewGuid().ToString('N'))"
            workspace = $Workspace
            startedAt = $now.ToString("o")
            heartbeatAt = $now.ToString("o")
            leaseExpiresAt = $now.AddSeconds([Math]::Max(5, $TtlSeconds)).ToString("o")
            status = "RUNNING"
            attempt = $attempt
            heartbeatCount = 0
        }
        $lockMetadata = [pscustomobject]@{ taskId = $State.TaskId; executionId = $id; processId = $ProcessId; leaseExpiresAt = $lease.leaseExpiresAt }
        $lockBytes = [Text.Encoding]::UTF8.GetBytes(($lockMetadata | ConvertTo-Json -Compress))
        $lockStream.Write($lockBytes, 0, $lockBytes.Length); $lockStream.Flush()
        Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease
        Add-HermesExecutionJournalEvent -TaskId $State.TaskId -Event "ACQUIRED" -Lease $lease
        $State.ExecutionAttempt = $attempt
        $State.ExecutionStatus = "RUNNING"
        $State.ExecutionStartedAt = $lease.startedAt
        $State.ExecutionHeartbeatAt = $lease.heartbeatAt
        $State.ExecutionCompletedAt = $null
        $State.ExecutionResultSummary = $null
        $State.ActiveExecutionId = $id
        $State.ExecutionLeaseActive = $true
        $State.ExecutionLeaseExpiresAt = $lease.leaseExpiresAt
        if ($State.State -notin @("RUNNING", "REPAIR_REQUIRED")) { $State.State = "RUNNING" }
        Save-TaskState -State $State
        return [pscustomobject]@{ acquired = $true; status = "ACQUIRED"; executionId = $id; lease = $lease; lockStream = $lockStream }
    } catch {
        if ($lockStream) { $lockStream.Dispose() }
        throw
    }
}

function Update-HermesExecutionHeartbeat {
    param($LeaseHandle, $State, [int]$TtlSeconds = 30)
    if (-not $LeaseHandle -or -not $LeaseHandle.acquired) { return $false }
    $lease = Get-HermesExecutionLease -TaskId $State.TaskId
    if (-not $lease -or $lease.executionId -ne $LeaseHandle.executionId -or $lease.status -ne "RUNNING") { return $false }
    $now = [datetime]::UtcNow
    $lease.heartbeatAt = $now.ToString("o")
    $lease.leaseExpiresAt = $now.AddSeconds([Math]::Max(5, $TtlSeconds)).ToString("o")
    $lease.heartbeatCount = [int]$lease.heartbeatCount + 1
    Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease
    $State.ExecutionHeartbeatAt = $lease.heartbeatAt
    $State.ExecutionLeaseExpiresAt = $lease.leaseExpiresAt
    Add-HermesExecutionJournalEvent -TaskId $State.TaskId -Event "HEARTBEAT" -Lease $lease
    return $true
}

function Complete-HermesExecutionLease {
    param($LeaseHandle, $State, [ValidateSet("COMPLETED", "FAILED", "INTERRUPTED", "CANCELLED", "BLOCKED")][string]$Status, $Result = $null)
    if (-not $LeaseHandle -or -not $LeaseHandle.acquired) { return $false }
    $lease = Get-HermesExecutionLease -TaskId $State.TaskId
    if (-not $lease -or $lease.executionId -ne $LeaseHandle.executionId) { return $false }
    $now = [datetime]::UtcNow
    if (-not ($lease.PSObject.Properties.Name -contains "completedAt")) { $lease | Add-Member -MemberType NoteProperty -Name completedAt -Value $null }
    if (-not ($lease.PSObject.Properties.Name -contains "resultSummary")) { $lease | Add-Member -MemberType NoteProperty -Name resultSummary -Value $null }
    $lease.status = $Status
    $lease.completedAt = $now.ToString("o")
    $lease.heartbeatAt = $now.ToString("o")
    $lease.leaseExpiresAt = $now.ToString("o")
    $lease.resultSummary = if ($Result) { ($Result | ConvertTo-Json -Depth 8 -Compress) } else { $Status }
    Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease
    Add-HermesExecutionJournalEvent -TaskId $State.TaskId -Event "FINALIZED" -Lease $lease -Details $Status
    $State.ExecutionStatus = $Status
    $State.ExecutionCompletedAt = $lease.completedAt
    $State.ExecutionResultSummary = $lease.resultSummary
    $State.ExecutionLeaseActive = $false
    $State.ExecutionLeaseExpiresAt = $lease.leaseExpiresAt
    if ($State.ActiveExecutionId -eq $lease.executionId) { $State.ActiveExecutionId = $null }
    Save-TaskState -State $State
    if ($LeaseHandle.lockStream) {
        try { $LeaseHandle.lockStream.Flush() } catch { }
        try { $LeaseHandle.lockStream.Close() } catch { }
        try { $LeaseHandle.lockStream.Dispose() } catch { }
        $LeaseHandle.lockStream = $null
    }
    Remove-Item -LiteralPath (Get-HermesExecutionLockPath -TaskId $State.TaskId) -Force -ErrorAction SilentlyContinue
    return $true
}

function Reconcile-HermesExecutionLease {
    param($State, [string]$Workspace = $RepoRoot, [datetime]$Now = [datetime]::UtcNow)
    $lease = Get-HermesExecutionLease -TaskId $State.TaskId
    if (-not $lease) { return [pscustomobject]@{ status = "NO_LEASE"; reconciled = $false; lease = $null } }
    if ($State.State -in @("COMPLETED", "COMPLETE", "FAILED", "CANCELLED")) {
        if ($lease.status -in @("RUNNING", "STARTING")) { $lease.status = "CANCELLED"; $lease.leaseExpiresAt = $Now.ToString("o"); Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease }
        return [pscustomobject]@{ status = "TERMINAL"; reconciled = $true; lease = $lease }
    }
    $workspaceMatches = (-not $lease.workspace) -or (([string]$lease.workspace -replace '/', '\').TrimEnd('\').ToLowerInvariant() -eq (([string]$Workspace -replace '/', '\').TrimEnd('\').ToLowerInvariant()))
    if (-not $workspaceMatches) {
        $State.State = "BLOCKED"; $State.ExecutionStatus = "INTERRUPTED"; $State.ExecutionResultSummary = "Execution lease workspace mismatch."; Save-TaskState -State $State
        $lease.status = "BLOCKED"; $lease.leaseExpiresAt = $Now.ToString("o"); Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease
        return [pscustomobject]@{ status = "WORKSPACE_BLOCKED"; reconciled = $true; lease = $lease }
    }
    if (Test-HermesLeaseFresh -Lease $lease -Now $Now) {
        $State.State = "RUNNING"; $State.ExecutionStatus = "RUNNING"; $State.ExecutionLeaseActive = $true; Save-TaskState -State $State
        return [pscustomobject]@{ status = "ACTIVE"; reconciled = $false; lease = $lease }
    }
    $State.State = "BLOCKED"; $State.ExecutionStatus = "INTERRUPTED"; $State.ExecutionResultSummary = "Execution lease expired or heartbeat became stale."; $State.ExecutionLeaseActive = $false; Save-TaskState -State $State
    $lease.status = "INTERRUPTED"; $lease.leaseExpiresAt = $Now.ToString("o"); Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath -TaskId $State.TaskId) -Value $lease
    Add-HermesExecutionJournalEvent -TaskId $State.TaskId -Event "RECONCILED_INTERRUPTED" -Lease $lease
    return [pscustomobject]@{ status = "INTERRUPTED"; reconciled = $true; lease = $lease }
}

function Invoke-HermesSupervisedProcess {
    param(
        [string]$CommandName,
        [string[]]$ArgumentList,
        [string]$InputText,
        $State,
        $LeaseHandle,
        [int]$HeartbeatIntervalSeconds = 2
    )
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $CommandName
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @($ArgumentList)) { [void]$startInfo.ArgumentList.Add([string]$argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Unable to start supervised process." }
        if ($InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        while (-not $process.HasExited) {
            Start-Sleep -Seconds ([Math]::Max(1, $HeartbeatIntervalSeconds))
            if (-not $process.HasExited) { [void](Update-HermesExecutionHeartbeat -LeaseHandle $LeaseHandle -State $State) }
        }
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        return [pscustomobject]@{ Started = $true; ExitCode = $process.ExitCode; Output = $stdout; ErrorOutput = $stderr; Succeeded = ($process.ExitCode -eq 0) }
    } catch {
        return [pscustomobject]@{ Started = $false; ExitCode = $null; Output = ""; ErrorOutput = $_.Exception.Message; Succeeded = $false }
    } finally { $process.Dispose() }
}

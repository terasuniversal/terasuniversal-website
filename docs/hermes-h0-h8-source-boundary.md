# TERAS Hermes H0–H8 source boundary

The TERAS repository is the source of truth for the H0–H8 operator state,
policy, validation, audit/evidence, queue, and read-only Telegram bridge
implementation.

The Python Hermes runtime is an external transport-integration target. Its
Telegram adapter may call the fixed TERAS bridge, but runtime-specific Python
files, credentials, logs, sessions, leases, databases, and other generated
state are not part of this repository.

The live editable installation is a deployment target, not an independent
source of truth. Runtime updates must record the source repository, branch,
commit, imported module paths, and restart/rollback evidence.

The active binding is configuration-driven through `TERAS_HERMES_WORKSPACE`
and `TERAS_CANONICAL_WORKSPACE`. Missing or unknown bindings fail closed; the
canonical CRM workspace remains protected from Hermes source tasks.

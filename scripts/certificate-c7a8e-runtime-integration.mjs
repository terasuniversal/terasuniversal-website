import assert from "node:assert/strict";
import { normalizeVerificationRpcResponse } from "../lib/public-verification-rpc.ts";

const valid = { found: true, certificate_number: "C7A8E_VALID", is_valid: true };
const legacy = { found: true, certificate_number: "PRODUCTION_LEGACY", training_date: "2026-09-14" };

assert.deepEqual(normalizeVerificationRpcResponse([valid], null), { kind: "found", row: valid });
assert.deepEqual(normalizeVerificationRpcResponse(valid, null), { kind: "found", row: valid });
assert.deepEqual(normalizeVerificationRpcResponse([], null), { kind: "not-found" });
assert.deepEqual(normalizeVerificationRpcResponse([{ found: false }], null), { kind: "not-found" });
assert.deepEqual(normalizeVerificationRpcResponse(null, { message: "transport failure" }), { kind: "error", reason: "rpc-error" });
assert.deepEqual(normalizeVerificationRpcResponse([{ found: true }, { found: true }], null), { kind: "error", reason: "multiple-rows" });
assert.deepEqual(normalizeVerificationRpcResponse([{ certificate_number: "malformed" }], null), { kind: "error", reason: "unexpected-shape" });

const malformedDate = { found: true, training_start_date: "2026-02-30" };
assert.equal(normalizeVerificationRpcResponse([malformedDate], null).kind, "found");
assert.deepEqual(normalizeVerificationRpcResponse([legacy], null), { kind: "found", row: legacy });

// Before repair, the deployed-shape object is rejected by `data.length > 0`.
assert.equal(valid.length, undefined);
assert.equal(normalizeVerificationRpcResponse(valid, null).kind, "found");

console.log("C7A8E runtime integration contract passed: array/object normalization, explicit errors, legacy compatibility, malformed-date preservation, and multi-row rejection.");
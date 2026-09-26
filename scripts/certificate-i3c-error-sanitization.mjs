import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const actionsPath = resolve(repoRoot, "app/admin/(protected)/certificates/actions.ts");
const actionsSource = readFileSync(actionsPath, "utf8");
const rawDbMessage = "RAW_DB_DETAIL certificate_private_constraint 42501";
let nextRpcError = null;
const serverLogs = [];

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith("lib/supabase/server")) {
    return { createSupabaseServerClient: async () => ({ rpc: async () => ({ data: null, error: nextRpcError }) }) };
  }
  if (request.endsWith("lib/auth/session")) {
    return {
      requireCertificate: async () => {},
      requireModuleAccess: async () => {},
    };
  }
  if (request.endsWith("lib/validation/schemas")) {
    return {
      certificateReissueSchema: { safeParse: (value) => ({ success: true, data: value }) },
      certificateRevokeSchema: { safeParse: (value) => ({ success: true, data: value }) },
    };
  }
  if (request === "next/cache") return { revalidatePath() {} };
  return originalLoad.call(this, request, parent, isMain);
};
const originalConsoleError = console.error;
console.error = (...args) => serverLogs.push(args);

try {
  const compiled = ts.transpileModule(actionsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText;
  const actionModule = new Module(actionsPath);
  actionModule.filename = actionsPath;
  actionModule.paths = Module._nodeModulePaths(repoRoot);
  actionModule._compile(compiled, actionsPath);
  const { revokeCertificate, reissueCertificate } = actionModule.exports;

  nextRpcError = { code: "42501", message: rawDbMessage };
  await assert.rejects(
    revokeCertificate("a3c00000-0000-4000-8000-000000000099", { get: () => "test" }),
    (error) => error.message === "Unable to revoke certificate." && !error.message.includes(rawDbMessage),
  );
  console.log("Unauthorized RPC 42501 → stable generic Server Action error: PASS");

  nextRpcError = { code: "P0001", message: "Invalid reissue event type." };
  await assert.rejects(
    reissueCertificate("a3c00000-0000-4000-8000-000000000099", { get: (name) => name === "event_type" ? "invalid-lifecycle" : "probe" }),
    (error) => error.message === "Unable to record the reissue event." && !error.message.includes("Invalid reissue event type."),
  );
  assert.ok(serverLogs.some((entry) => entry[0] === "Certificate reissue event failed" && entry[1]?.code === "P0001"));
  console.log("Invalid lifecycle P0001 → generic action error; detailed code only in server log: PASS");

  nextRpcError = { code: "P0002", message: "Certificate not found." };
  await assert.rejects(
    revokeCertificate("a3c00000-0000-4000-8000-000000000099", { get: () => "probe" }),
    (error) => error.message === "Unable to revoke certificate." && !error.message.includes("Certificate not found."),
  );
  console.log("Missing certificate P0002 → stable generic Server Action error: PASS");

  assert.doesNotMatch(actionsSource, /return\s*\{[^}]*message\s*:\s*error\.message/s);
  assert.doesNotMatch(actionsSource, /throw\s+new\s+Error\(\s*error\.message\s*\)/);
  assert.match(actionsSource, /console\.error\("Certificate issuance RPC failed"[\s\S]*?message:\s*error\.message/);
  console.log("Raw DB messages are not returned/thrown to the UI; issuance detail remains server-side: PASS");
} finally {
  Module._load = originalLoad;
  console.error = originalConsoleError;
}

/**
 * Phase 2F verification script for lib/payments/toyyibpay.ts's environment
 * resolver. Not a full test suite (this project has no jest/vitest
 * installed, and adding one is out of scope for this patch) -- a focused,
 * dependency-free check exercising the real exported functions, following
 * this repo's existing scripts/check-*.cjs convention.
 *
 * Run: node --experimental-transform-types scripts/check-toyyibpay-env-resolver.mts
 * (--experimental-strip-types is not enough here: lib/payments/toyyibpay.ts
 * uses a TS constructor parameter property in ToyyibPayNonJsonResponseError,
 * which strip-only mode rejects -- transform mode handles it.)
 *
 * Mocks global.fetch so no real network call is ever made -- this script
 * never talks to ToyyibPay (sandbox or production) and never needs real
 * credentials.
 */

import assert from "node:assert/strict";

type FetchCall = { url: string; body: string };
const calls: FetchCall[] = [];

// @ts-expect-error -- test-only fetch stub, shape intentionally minimal.
globalThis.fetch = async (url: string, opts: { body: URLSearchParams }) => {
  calls.push({ url, body: opts.body.toString() });
  return {
    ok: true,
    text: async () => JSON.stringify([{ BillCode: "TESTBILL123" }]),
  };
};

function resetEnv() {
  delete process.env.TOYYIBPAY_ENV;
  process.env.TOYYIBPAY_USER_SECRET_KEY = "test-secret";
  process.env.TOYYIBPAY_CATEGORY_CODE = "test-category";
  calls.length = 0;
}

const billInput = {
  invoiceNo: "INV-TEST-0001",
  description: "Verification script test bill",
  amountSen: 100,
  returnUrl: "https://www.terasuniversal.com.my/payments/toyyibpay/return",
  callbackUrl: "https://www.terasuniversal.com.my/api/payments/toyyibpay/callback",
  externalReferenceNo: "00000000-0000-0000-0000-000000000000",
  billTo: "QA Fixture",
};

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    })
    .catch((err) => {
      console.error(`  FAIL - ${name}`);
      console.error(`         ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}

async function main() {
  const { createBill, verifyCallbackHash, getToyyibpayCapability } = await import(
    "../lib/payments/toyyibpay.ts"
  );

  console.log("1. env=sandbox -> dev.toyyibpay.com");
  await check("createBill routes to https://dev.toyyibpay.com", async () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "sandbox";
    const result = await createBill(billInput);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/dev\.toyyibpay\.com\//);
    assert.equal(result.paymentUrl, "https://dev.toyyibpay.com/TESTBILL123");
  });

  console.log("2. env=production -> toyyibpay.com");
  await check("createBill routes to https://toyyibpay.com", async () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "production";
    const result = await createBill(billInput);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/toyyibpay\.com\//);
    assert.equal(calls[0].url.startsWith("https://dev.toyyibpay.com"), false);
    assert.equal(result.paymentUrl, "https://toyyibpay.com/TESTBILL123");
  });

  console.log("3. env missing -> hard fail, no fetch, no fallback");
  await check("createBill throws when TOYYIBPAY_ENV is unset", async () => {
    resetEnv();
    // TOYYIBPAY_ENV intentionally left unset by resetEnv().
    await assert.rejects(() => createBill(billInput), /TOYYIBPAY_ENV must be exactly "sandbox" or "production"/);
    assert.equal(calls.length, 0, "must not make any HTTP call when env is unset");
  });
  await check("verifyCallbackHash throws when TOYYIBPAY_ENV is unset", () => {
    resetEnv();
    assert.throws(
      () => verifyCallbackHash({ status: "1", orderId: "x", refno: "y", hash: "z" }),
      /TOYYIBPAY_ENV must be exactly "sandbox" or "production"/
    );
  });

  console.log("4. env invalid (e.g. 'staging') -> hard fail, no fetch, no fallback");
  await check("createBill throws on an unrecognized TOYYIBPAY_ENV value", async () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "staging";
    await assert.rejects(() => createBill(billInput), /TOYYIBPAY_ENV must be exactly "sandbox" or "production"/);
    assert.equal(calls.length, 0, "must not make any HTTP call for an invalid env value");
  });
  await check("createBill error never silently falls back to sandbox or production", async () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "prod"; // common typo -- must NOT be treated as "production"
    await assert.rejects(() => createBill(billInput));
    assert.equal(calls.length, 0);
  });

  console.log("5/6. UI capability: getToyyibpayCapability() enabled for both supported modes");
  await check("capability.enabled === true for sandbox, isSandbox === true", () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "sandbox";
    const cap = getToyyibpayCapability();
    assert.equal(cap.enabled, true);
    assert.equal(cap.isSandbox, true);
  });
  await check("capability.enabled === true for production, isSandbox === false", () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "production";
    const cap = getToyyibpayCapability();
    assert.equal(cap.enabled, true);
    assert.equal(cap.isSandbox, false);
  });
  await check("capability.enabled === false when env unset/invalid (card must not render)", () => {
    resetEnv();
    const capUnset = getToyyibpayCapability();
    assert.equal(capUnset.enabled, false);
    process.env.TOYYIBPAY_ENV = "staging";
    const capInvalid = getToyyibpayCapability();
    assert.equal(capInvalid.enabled, false);
  });

  console.log("7. sandbox badge signal: isSandbox true only in sandbox");
  await check("isSandbox is exactly the badge-visibility source of truth", () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "sandbox";
    assert.equal(getToyyibpayCapability().isSandbox, true);
    process.env.TOYYIBPAY_ENV = "production";
    assert.equal(getToyyibpayCapability().isSandbox, false);
  });
  console.log(
    "   NOTE: this confirms the boolean InvoiceActionsPanel.tsx's `{toyyibpayIsSandbox && <span>SANDBOX / TEST PAYMENT</span>}`\n" +
      "   and page.tsx's `{toyyibpayIsSandbox ? \"(open sandbox link ↗)\" : \"(open payment link ↗)\"}` are gated on. Actual\n" +
      "   JSX rendering is not exercised here -- this repo has no jest/React Testing Library installed, and installing one\n" +
      "   was out of scope for this patch. Verified by direct code reading in both files instead."
  );

  console.log("8. no secret/client leakage");
  await check("getToyyibpayCapability() return shape never includes secret fields", () => {
    resetEnv();
    process.env.TOYYIBPAY_ENV = "sandbox";
    const cap = getToyyibpayCapability() as Record<string, unknown>;
    for (const key of Object.keys(cap)) {
      assert.doesNotMatch(key.toLowerCase(), /secret|category|key/);
    }
    assert.deepEqual(Object.keys(cap).sort(), ["enabled", "env", "isSandbox"]);
  });
  await check("no NEXT_PUBLIC_TOYYIBPAY_* reference anywhere in the app", async () => {
    const { execSync } = await import("node:child_process");
    let out = "";
    try {
      out = execSync(
        'grep -rn "NEXT_PUBLIC_TOYYIBPAY" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next .',
        { cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"), encoding: "utf8" }
      );
    } catch (err: any) {
      // grep exits 1 when there are zero matches -- that's the expected/passing case.
      if (err.status !== 1) throw err;
    }
    assert.equal(out.trim(), "", `found NEXT_PUBLIC_TOYYIBPAY reference(s):\n${out}`);
  });

  resetEnv();
  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) {
    console.error("Some checks FAILED -- see above.");
    process.exit(process.exitCode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

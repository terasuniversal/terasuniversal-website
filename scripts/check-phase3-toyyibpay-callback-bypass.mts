import { strict as assert } from "node:assert";
import { registrationCallbackUrl } from "../lib/payments/toyyibpay.ts";

const origin = "https://staging.terasuniversal.com.my";
const previous = {
  env: process.env.TOYYIBPAY_ENV,
  vercel: process.env.VERCEL_ENV,
  bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
};

try {
  process.env.TOYYIBPAY_ENV = "sandbox";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "synthetic-bypass-for-check";
  assert.equal(
    registrationCallbackUrl(origin),
    `${origin}/api/payments/toyyibpay/registration-callback?x-vercel-protection-bypass=synthetic-bypass-for-check`,
  );

  process.env.VERCEL_ENV = "production";
  assert.equal(registrationCallbackUrl("https://terasuniversal.com.my"), `${"https://terasuniversal.com.my"}/api/payments/toyyibpay/registration-callback`);

  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "";
  process.env.VERCEL_ENV = "preview";
  assert.equal(registrationCallbackUrl(origin), `${origin}/api/payments/toyyibpay/registration-callback`);

  console.log("PHASE3_TOYYIBPAY_CALLBACK_BYPASS_CHECK_PASS");
} finally {
  if (previous.env === undefined) delete process.env.TOYYIBPAY_ENV;
  else process.env.TOYYIBPAY_ENV = previous.env;
  if (previous.vercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previous.vercel;
  if (previous.bypass === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = previous.bypass;
}

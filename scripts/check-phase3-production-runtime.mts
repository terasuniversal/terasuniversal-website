import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanRuntimeEnvValue } from "../lib/supabase/env.ts";

assert.equal(cleanRuntimeEnvValue("\uFEFFhttps://example.supabase.co"), "https://example.supabase.co");
assert.equal(cleanRuntimeEnvValue("  publishable-key  "), "publishable-key");
assert.equal(cleanRuntimeEnvValue("key\r\n"), "key");
assert.equal(cleanRuntimeEnvValue("key\u0000"), "");

const rateLimitSource = await readFile(new URL("../lib/rate-limit.js", import.meta.url), "utf8");
assert.match(rateLimitSource, /cleanRuntimeEnvValue\(process\.env\.NEXT_PUBLIC_SUPABASE_URL\)/);
assert.match(rateLimitSource, /cleanRuntimeEnvValue\(process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\)/);
assert.match(rateLimitSource, /p_key: safeKey/);

const publicContentSource = await readFile(new URL("../lib/public-content.ts", import.meta.url), "utf8");
assert.match(publicContentSource, /Promise<\{ schedules: PublicSchedule\[\]; error: boolean \}>/);
assert.match(publicContentSource, /return \{ schedules: \[\], error: true \}/);

console.log("Phase 3 production runtime checks passed: env normalization, safe limiter key handling, and empty/error schedule result model.");

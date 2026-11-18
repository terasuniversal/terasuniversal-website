// Public-First F-1 offline test doubles (fabricated data only). Stand in for lib/supabase.js, lib/supabase/server,
// lib/rate-limit and next/cache so the real registration routes and lib/public-content.ts run with no database,
// network or cache. State lives on globalThis.__gate and is reset by the test before every scenario.
const state = () => globalThis.__gate;

function client(kind) {
  return {
    kind,
    async rpc(name, args) {
      const s = state();
      s.rpcs.push({ name, args, kind });
      return s.rpcAnswer ? s.rpcAnswer(name, args) : { data: null, error: { message: "synthetic: no answer" } };
    },
    from(table) {
      state().reads.push(table);
      const builder = { select: () => builder, eq: () => builder, in: () => builder, is: () => builder, order: () => builder, limit: () => builder, maybeSingle: async () => ({ data: null, error: null }) };
      return builder;
    },
  };
}

export function getSupabaseClient() { return client("anon"); }
export async function createSupabaseServerClient() { return client("server"); }
export function createSupabaseServiceClient() { return client("service"); }
export function createSupabaseBrowserClient() { throw new Error("not available in tests"); }

export async function checkSharedRateLimit(options) { state().rateLimits.push(options.key); return true; }
export function hashedClientId(value) { return `synthetic:${String(value).length}`; }

export function unstable_cache(fn) { return (...args) => fn(...args); }
export function revalidateTag() {}
export function revalidatePath() {}

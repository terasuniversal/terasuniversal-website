// The SCAFFOLD-X (YPM-sponsored) career training programme was discontinued and its page retired on
// 5 Nov 2026. 410 tells visitors and search engines the page is gone on purpose; it does not redirect
// to another programme. The former page and poster are kept in docs/archive/program-tajaan-ypm.
const body = `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Program tidak lagi ditawarkan | TERAS UNIVERSAL</title></head><body><main><h1>Program ini tidak lagi ditawarkan</h1><p>This programme is no longer offered.</p><p><a href="/">TERAS UNIVERSAL</a> &middot; <a href="/training">Training</a> &middot; <a href="/contact">Contact</a></p></main></body></html>`;

export function GET() {
  return new Response(body, { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } });
}

export function HEAD() {
  return new Response(null, { status: 410, headers: { "X-Robots-Tag": "noindex" } });
}

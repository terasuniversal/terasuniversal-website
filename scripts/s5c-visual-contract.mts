import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revertPublicFirst } from "./public-first-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";

// S5C (owner-approved, local only): authentic TERAS drone photographs (October 2024, own training yard) replace the
// abstract panels on /about and /contact and the scaffolding poster of unverified provenance on /services and
// /services/scaffolding. The AI homepage hero R1-3 stayed through S5C; Release 2 S1 replaces it with V3-R-2 (see below).
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const bytes = (path: string) => readFileSync(new URL(path, root));
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
let failures = 0;
// Public-First launch (owner-approved, Option B): while the drone photographs' publication rights are unconfirmed they
// are withheld -- removed from public/ (byte-identical copies kept outside the repository) and their slots show the
// approved abstract panels. The checks below then prove the S5C integration through revertPublicFirst() and prove
// the files are no longer served; scripts/public-first-launch-contract.mts covers the withheld state itself.
const PHOTOS_WITHHELD = !existsSync(new URL("public/images/authentic", root));
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// Exported by docs/S5C-FINAL-VISUAL-ASSETS/assets/export_yard.py from the untouched originals (crop + resize only).
const ASSETS: Record<string, [string, number, number]> = {
  "public/images/authentic/teras-yard-trainees-landscape.webp": ["3d23616c89149a96a150054f6bdaf638ccc6f77bdf452fd6054a565231ce4582", 1500, 1000],
  "public/images/authentic/teras-yard-trainees-portrait.webp": ["e9943b58c5d76e03bcc057b45804b4c279b4108558826e430634e01a127737f2", 900, 1350],
  "public/images/authentic/teras-yard-overhead-landscape.webp": ["9a1e89a351c8e99c77cf1e59c6e6edaa57a9760ccec0425ab74760b3d8256e6e", 1500, 1000],
  "public/images/authentic/teras-yard-overhead-portrait.webp": ["ef8a7b32577be70adad81e62c973569e104fe8e00ff5e81b3f9585a601507754", 900, 1350],
};
const webpChunks = (data: Buffer) => {
  const chunks: string[] = [];
  for (let i = 12; i + 8 <= data.length;) { const size = data.readUInt32LE(i + 4); chunks.push(data.toString("latin1", i, i + 4)); i += 8 + size + (size & 1); }
  return chunks;
};
check("authentic photographs: pinned files, expected size, under 300 KB, and no EXIF/XMP (the drone GPS is gone)", () => {
  if (PHOTOS_WITHHELD) {
    for (const path of Object.keys(ASSETS)) assert.equal(existsSync(new URL(path, root)), false, `${path}: withheld, not served`);
    return;
  }
  for (const [path, [hash, width, height]] of Object.entries(ASSETS)) {
    const data = bytes(path);
    assert.equal(sha(data), hash, path);
    assert.equal(data.toString("latin1", 0, 4) + data.toString("latin1", 8, 12), "RIFFWEBP", path);
    assert.deepEqual(webpChunks(data), ["VP8 "], `${path}: only image data`);
    assert.equal(data.readUInt16LE(26) & 0x3fff, width, `${path} width`);
    assert.equal(data.readUInt16LE(28) & 0x3fff, height, `${path} height`);
    assert.ok(data.length < 300_000, `${path} ${data.length} bytes`);
  }
});

const CAPTION = "<figcaption className={bridge.photoNote}>Photograph: TERAS UNIVERSAL training yard, Kedah, 2024.</figcaption>";
const PLACES: [string, string, string][] = [
  ["app/about/page.js", "about-story-media", "teras-yard-trainees-landscape"],
  ["app/contact/page.js", "contact-page-hero-media", "teras-yard-overhead-landscape"],
  ["app/services/page.js", "service-detail-media scaffolding-teaser-media", "teras-yard-trainees-portrait"],
  ["app/services/scaffolding/page.js", "scaffolding-hero-media", "teras-yard-trainees-portrait"],
  ["app/services/scaffolding/page.js", "scaffolding-poster-media", "teras-yard-overhead-portrait"],
];
check("integration: each figure shows its photograph with descriptive alt text and the photograph caption", () => {
  for (const [path, figure, asset] of PLACES) {
    const match = revertPublicFirst(path, read(path)).match(new RegExp(`<figure className="${figure}">([\\s\\S]*?)</figure>`));
    assert.ok(match, `${path} ${figure}`);
    const body = match![1];
    assert.ok(body.includes(`src="/images/authentic/${asset}.webp"`), `${path} ${figure} src`);
    assert.match(body, /alt="(Aerial|Overhead aerial) photograph of the TERAS UNIVERSAL practical training yard in Kedah[^"]+October 2024"/, `${path} alt`);
    assert.ok(body.endsWith(CAPTION), `${path} caption`);
    assert.doesNotMatch(body, /AI-generated|unoptimized|panel-[abc]\.svg/, `${path} ${figure}`);
  }
});
check("poster of unverified provenance: no longer referenced by public code; file kept byte-identical", () => {
  // git grep exits 1 when nothing matches, which is the expected result here; any other failure still throws.
  let users = "";
  try { users = execFileSync("git", ["grep", "-l", "--untracked", "scaffolding-rental-poster", "--", "app", "components", "data", "content", "lib"], { cwd: rootPath, encoding: "utf8" }).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  assert.equal(users, "");
  // Public-First F-3: the poster left public/ (not served); the committed blob in git history stays byte-identical.
  const poster = existsSync(new URL("public/images/scaffolding-rental-poster-en.webp", root)) ? bytes("public/images/scaffolding-rental-poster-en.webp") : execFileSync("git", ["show", `${CONTRACT_BASE}:public/images/scaffolding-rental-poster-en.webp`], { cwd: rootPath, maxBuffer: 1 << 26 });
  assert.equal(sha(poster), "8f1a85afefc5c96fdec8d374f91365b913cf262e90c4ee394a8ce2fe83c38363");
});
// R2 S1 (owner K-DEV, 19 Nov 2026): the homepage hero moves to the V3-R-2 illustration (ring-corrected source SHA-256
// 9ac58e9ad853de1470ae52fe8767bf6d91065c6e0995ceb3abe617401e7a2516; owner design approval and owner-confirmed HSE
// approval recorded in the design workspace). The R1-3 files stay in public/ byte-identical for rollback.
check("homepage hero: V3-R-2 component and its three image files pinned; R1-3 files kept unchanged for rollback", () => {
  assert.equal(sha(read("components/home/HomeHero.js")), "ef17a53f1b84d4db0211ff8999e71aa996883f3c8304a6102446c9405786113b");
  assert.equal(sha(bytes("public/images/v2/hero-v3r2-desktop.webp")), "ba7e433f953973ced051814db19fa8cbadfbd8e27bee6ac00532b9332bf330e6");
  assert.equal(sha(bytes("public/images/v2/hero-v3r2-tablet.webp")), "7add6ad7403d0e73600cbd9886af337ace5dfbb018c4f711cee47e72e14e843a");
  assert.equal(sha(bytes("public/images/v2/hero-v3r2-phone.webp")), "f329ecaa17486435122426cd4473b7cdad72211c1d223d9bb1b8f9659c56a0fd");
  assert.equal(sha(bytes("public/images/v2/hero-r1-3-desktop.webp")), "282015399a6e528be747c2814532a5312ff1ad1f9408e563470170b5e88290be");
  assert.equal(sha(bytes("public/images/v2/hero-r1-3-phone.webp")), "ae24036363584f8e0f49e1fe32252a411e8cefc1849864431b6b992026a3a15f");
  assert.match(read("components/home/HomeHero.js"), /const HERO_ALT = "AI-generated illustration: [^"]+Not a TERAS-owned or client-owned facility\."/);
});
check("AI disclosures elsewhere unchanged: /about hero caption, homepage hero and delivery captions, footer note", () => {
  assert.ok(read("app/about/page.js").includes("<figcaption className={bridge.aiNote}>AI-generated illustration for visual representation.</figcaption>"));
  assert.match(read("components/home/HomeHero.js"), /<figcaption className=\{styles\.note\}>AI-generated illustration — not a TERAS-owned or client-owned facility<\/figcaption>/);
  assert.match(read("components/home/DeliveryOptions.js"), /AI-generated illustration for visual representation\./);
  assert.match(read("content/en/footer.js"), /AI-generated illustrations/);
});
check("caption style: scoped to the bridge page, same overlay as the AI note, positioning only for the three figures", () => {
  const css = read("components/premium/legacy-bridge.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /^\.page \.photoNote \{[^}]*position: absolute;[^}]*background: rgba\(7, 42, 72, 0\.85\);[^}]*color: #ffffff;[^}]*\}/m);
  assert.match(css, /^\.page :global\(:is\(\.contact-page-hero-media, \.scaffolding-hero-media, \.scaffolding-poster-media\)\) \{\s*position: relative;\s*\}/m);
  // Reserves the portrait figures' height before the lazy image loads (layout-shift fix, measured in S5C QA).
  assert.match(css, /^\.page :global\(:is\(\.scaffolding-teaser-media, \.scaffolding-poster-media\)\) \{\s*width: 100%;\s*\}/m);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);

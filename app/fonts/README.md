# Self-hosted fonts

Latin-subset WOFF2 files for the three families the site uses, loaded with `next/font/local`
in `app/layout.js` (Montserrat, Poppins) and `app/admin/layout.tsx` (Inter). A build never
contacts Google Fonts.

`manifest.json` is the source of truth: for every file it records the family, version, weights,
source URL, size and SHA-256, plus the SIL OFL 1.1 licence text for each family
(`LICENSES/`) and where it came from. `npm run test:font-assets` verifies all of it.

- Files are unmodified and byte-identical to what the Next.js Google loader previously
  downloaded and self-hosted at build time, so rendered Latin text is unchanged.
- Only the Latin subset is shipped (`U+0000-00FF` and the other ranges listed in the manifest).
  Letters outside it (for example Latin Extended, Cyrillic, Greek, Vietnamese, Devanagari) fall
  back to the next font in the stack. `npm run test:font-assets` fails if site source contains such letters.
- To add or change a font: obtain the unmodified file, add it with its OFL text, update
  `manifest.json` (size and SHA-256), and keep this folder free of other files.

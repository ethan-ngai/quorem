/** @file generate-brand.ts @description Rasterize the existing marketing lockup for email clients. @module auth */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const root = new URL("../../../", import.meta.url);
const mark = await readFile(new URL("web/public/logo-pixel.svg", root), "utf8");
const source = await readFile(
  new URL("marketing/src/components/QuoremWordmark.astro", root),
  "utf8",
);
const wordmark = source
  .slice(source.indexOf("<svg"), source.indexOf("</svg>") + 6)
  .replaceAll("id={`${id}-q-clip`}", 'id="q-clip"')
  .replaceAll("id={`${id}-letter-clip`}", 'id="letter-clip"')
  .replaceAll("clip-path={`url(#${id}-q-clip)`}", 'clip-path="url(#q-clip)"')
  .replaceAll("clip-path={`url(#${id}-letter-clip)`}", 'clip-path="url(#letter-clip)"');
for (const [suffix, color] of [
  ["", "#1e2023"],
  ["-dark", "#e0e2e5"],
]) {
  // Same 32:12:112 proportions as BrandLockup.astro; 3x raster avoids blurry small marks.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="585" height="120" viewBox="0 0 156 32" fill="${color}">${mark.replace("<svg ", '<svg x="0" y="0" width="32" height="32" ')}${wordmark.replace("<svg ", '<svg x="44" y="7.6" width="112" height="22.7" ').replace('fill="currentColor"', `fill="${color}"`)}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  for (const directory of [
    new URL("web/public/email/", root),
    new URL("auth/emails/static/", root),
  ]) {
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(`quorem-lockup${suffix}.png`, directory), png);
  }
}

// Generates Android launcher icons and splash screens from mobile/assets/*.svg (run: node scripts/android-assets.mjs)
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const res = "android/app/src/main/res";
const NAVY = "#10233f";
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const out = (p) => (mkdirSync(path.dirname(p), { recursive: true }), p);

for (const [d, f] of Object.entries(dens)) {
  const legacy = Math.round(48 * f);
  const fg = Math.round(108 * f);
  await sharp("mobile/assets/icon.svg", { density: 600 }).resize(legacy, legacy).png().toFile(out(`${res}/mipmap-${d}/ic_launcher.png`));
  const r = legacy / 2;
  const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
  await sharp("mobile/assets/icon.svg", { density: 600 }).resize(legacy, legacy).composite([{ input: circle, blend: "dest-in" }]).png().toFile(out(`${res}/mipmap-${d}/ic_launcher_round.png`));
  await sharp("mobile/assets/icon-foreground.svg", { density: 600 }).resize(fg, fg).png().toFile(out(`${res}/mipmap-${d}/ic_launcher_foreground.png`));
}

async function splash(w, h, file) {
  const logo = Math.round(Math.min(w, h) * 0.22);
  const mark = await sharp("mobile/assets/icon.svg", { density: 600 }).resize(logo, logo).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: NAVY } })
    .composite([{ input: mark, left: Math.round((w - logo) / 2), top: Math.round((h - logo) / 2) }])
    .png()
    .toFile(out(file));
}
const port = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(port)) {
  await splash(w, h, `${res}/drawable-port-${d}/splash.png`);
  await splash(h, w, `${res}/drawable-land-${d}/splash.png`);
}
await splash(480, 320, `${res}/drawable/splash.png`);
console.log("Android icons and splash screens generated.");

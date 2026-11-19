#!/usr/bin/env node
// Draws the placeholder product images of the demo catalogue: neutral, flat SVG silhouettes made
// from scratch (no photos, no third-party artwork). It reads content/products.json and writes one
// file per image that has a "placeholder" key, into public/. Run it again after editing the demo:
//
//   npm run images
//
// Real stores replace these with photos (WebP/AVIF, see GETTING-STARTED.md) and delete the
// "placeholder" key so this script leaves them alone.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { products } = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8"));

const hex = (c) => c.replace("#", "").match(/../g).map((h) => parseInt(h, 16));
const mix = (c, to, k) => "#" + hex(c).map((v, i) => Math.round(v + (hex(to)[i] - v) * k).toString(16).padStart(2, "0")).join("");
const dark = (c, k = 0.22) => mix(c, "#000000", k);
const light = (c, k = 0.25) => mix(c, "#ffffff", k);

// Each shape is drawn inside an 800 × 1000 box, centred near (400, 520).
const SHAPES = {
  tee: (c) => `<path d="M300 250C330 285 470 285 500 250L640 310 690 450 600 490 580 430V780Q400 800 220 780V430L200 490 110 450 160 310Z" fill="${c}"/>
    <path d="M300 250C330 300 470 300 500 250" fill="none" stroke="${dark(c)}" stroke-width="12" stroke-linecap="round"/>
    <path d="M220 430V780M580 430V780" stroke="${dark(c, 0.1)}" stroke-width="4"/>`,
  hoodie: (c) => `<path d="M290 270 180 330 110 640 190 665 235 480V790Q400 810 565 790V480L610 665 690 640 620 330 510 270Z" fill="${c}"/>
    <path d="M290 270C290 150 510 150 510 270 480 335 320 335 290 270Z" fill="${dark(c, 0.14)}"/>
    <path d="M330 275C345 215 455 215 470 275 440 300 360 300 330 275Z" fill="${dark(c, 0.35)}"/>
    <path d="M300 640H500L530 745H270Z" fill="${dark(c, 0.1)}"/>
    <path d="M370 300V420M430 300V420" stroke="${light(c, 0.5)}" stroke-width="7" stroke-linecap="round"/>`,
  cap: (c) => `<path d="M210 560C210 320 590 320 590 560Z" fill="${c}"/>
    <path d="M200 560C320 535 560 540 700 600 600 652 330 642 200 592Z" fill="${dark(c, 0.2)}"/>
    <path d="M400 380V560M300 420C320 470 325 520 322 560M500 420C480 470 475 520 478 560" fill="none" stroke="${dark(c, 0.12)}" stroke-width="5"/>
    <circle cx="400" cy="382" r="13" fill="${dark(c, 0.25)}"/>`,
  socks: (c) => {
    const one = (fill) => `<path d="M290 230H400V560C400 600 470 640 520 662 572 684 560 770 500 770H380C320 770 290 725 290 665Z" fill="${fill}"/>
      <rect x="290" y="230" width="110" height="52" fill="${dark(fill, 0.16)}"/><path d="M290 310H400M290 335H400" stroke="${dark(fill, 0.1)}" stroke-width="6"/>
      <path d="M452 770C440 730 470 690 520 662 572 684 560 770 500 770Z" fill="${dark(fill, 0.16)}"/>`;
    return `<g transform="translate(120 30)">${one(dark(c, 0.08))}</g><g transform="translate(-40 0)">${one(c)}</g>`;
  },
  tote: (c) => `<path d="M290 430C290 215 510 215 510 430" fill="none" stroke="${dark(c, 0.18)}" stroke-width="24"/>
    <path d="M220 420H580L612 820H188Z" fill="${c}"/><path d="M220 420H580L583 455H217Z" fill="${dark(c, 0.1)}"/>`,
  backpack: (c) => `<path d="M350 270C350 190 450 190 450 270" fill="none" stroke="${dark(c, 0.3)}" stroke-width="20"/>
    <rect x="215" y="255" width="370" height="545" rx="120" fill="${c}"/>
    <path d="M250 440Q400 385 550 440" fill="none" stroke="${dark(c, 0.25)}" stroke-width="8"/>
    <rect x="268" y="530" width="264" height="200" rx="44" fill="${dark(c, 0.14)}"/>
    <rect x="375" y="560" width="50" height="16" rx="8" fill="${light(c, 0.4)}"/>`,
  bottle: (c) => `<rect x="352" y="190" width="96" height="72" rx="16" fill="${dark(c, 0.35)}"/><rect x="366" y="255" width="68" height="46" fill="${dark(c, 0.15)}"/>
    <rect x="308" y="292" width="184" height="530" rx="54" fill="${c}"/>
    <rect x="334" y="340" width="22" height="430" rx="11" fill="#ffffff" opacity=".28"/>`,
  notebook: (c) => `<rect x="232" y="240" width="340" height="540" rx="18" fill="${c}"/><rect x="232" y="240" width="30" height="540" rx="10" fill="${dark(c, 0.2)}"/>
    <rect x="506" y="240" width="18" height="540" fill="${dark(c, 0.3)}"/><rect x="300" y="340" width="160" height="74" rx="8" fill="#ffffff" opacity=".86"/>
    <path d="M322 368H438M322 388H400" stroke="${dark(c, 0.1)}" stroke-width="6" stroke-linecap="round"/>`,
  mug: (c) => `<path d="M505 410C625 410 625 600 505 600" fill="none" stroke="${c}" stroke-width="36"/>
    <path d="M250 340H510V640Q510 680 470 680H290Q250 680 250 640Z" fill="${c}"/>
    <ellipse cx="380" cy="342" rx="130" ry="24" fill="${dark(c, 0.14)}"/><ellipse cx="380" cy="346" rx="112" ry="16" fill="${dark(c, 0.4)}"/>
    <rect x="272" y="390" width="18" height="230" rx="9" fill="#ffffff" opacity=".3"/>`,
  cushion: (c) => `<path d="M190 300Q400 262 610 300 650 500 610 700 400 738 190 700 150 500 190 300Z" fill="${c}"/>
    <path d="M215 330Q400 300 585 330M215 670Q400 700 585 670" fill="none" stroke="${dark(c, 0.12)}" stroke-width="5" stroke-dasharray="14 12"/>
    <path d="M300 420Q400 500 500 420M300 520Q400 600 500 520" fill="none" stroke="${light(c, 0.35)}" stroke-width="10" stroke-linecap="round"/>`,
  candle: (c) => `<path d="M400 372V338" stroke="#3a3a3a" stroke-width="5"/><path d="M400 338C378 310 392 290 400 266 408 290 422 310 400 338Z" fill="#f0b04a"/>
    <rect x="280" y="380" width="240" height="350" rx="30" fill="${light(c, 0.35)}"/><rect x="280" y="430" width="240" height="300" rx="30" fill="${c}"/>
    <ellipse cx="400" cy="384" rx="118" ry="18" fill="${light(c, 0.6)}"/>
    <rect x="322" y="505" width="156" height="112" rx="10" fill="#ffffff" opacity=".88"/><path d="M346 545H454M346 572H420" stroke="${dark(c, 0.3)}" stroke-width="6" stroke-linecap="round"/>`,
  print: (c) => `<rect x="205" y="200" width="390" height="560" rx="4" fill="#fdfcf9" stroke="${dark("#d9d4c8", 0.05)}" stroke-width="6"/>
    <circle cx="350" cy="400" r="92" fill="${c}"/><path d="M250 640Q330 520 420 600T550 540V700H250Z" fill="${light(c, 0.45)}"/>
    <circle cx="470" cy="330" r="34" fill="${mix(c, "#d9843a", 0.75)}"/>`,
  blanket: (c) => `<path d="M200 330Q400 290 600 330V690Q400 730 200 690Z" fill="${c}"/>
    <path d="M200 420Q400 380 600 420M200 510Q400 470 600 510M200 600Q400 560 600 600" fill="none" stroke="${dark(c, 0.14)}" stroke-width="7"/>
    <path d="M600 330V690C640 680 652 640 640 520 652 400 640 345 600 330Z" fill="${dark(c, 0.22)}"/>
    <path d="M214 700V742M250 706V750M286 710V756M322 713V760M358 715V762M394 716V763M430 715V762M466 713V760M502 710V756M538 706V750M574 701V744" stroke="${dark(c, 0.1)}" stroke-width="8" stroke-linecap="round"/>`,
};

function svg({ shape, color, view }, title) {
  const draw = SHAPES[shape];
  if (!draw) throw new Error(`Unknown placeholder shape "${shape}"`);
  // Light products need a darker backdrop to stand out.
  const pale = hex(color).reduce((a, v) => a + v, 0) / 765 > 0.84;
  const tint = mix(pale ? "#cfcbc2" : "#eceae5", color, 0.07);
  let body;
  if (view === "detail") {
    body = `<rect width="800" height="1000" fill="${pale ? "#c9c5bb" : mix("#e6e3dc", color, 0.1)}"/><g transform="translate(400 500) scale(1.4) translate(-400 -470)">${draw(color)}</g>`;
  } else if (view === "scene") {
    body = `<rect width="800" height="1000" fill="${pale ? "#cdc8be" : mix("#e9e4da", color, 0.16)}"/><rect y="760" width="800" height="240" fill="${pale ? "#bbb5a9" : mix("#d9d2c4", color, 0.2)}"/>
      <circle cx="610" cy="250" r="120" fill="#ffffff" opacity=".35"/><ellipse cx="400" cy="800" rx="230" ry="26" fill="#000000" opacity=".12"/>
      <g transform="translate(400 520) scale(.82) translate(-400 -500)">${draw(color)}</g>`;
  } else {
    body = `<rect width="800" height="1000" fill="url(#bg)"/><ellipse cx="400" cy="850" rx="250" ry="24" fill="#000000" opacity=".09"/>${draw(color)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" role="img" aria-label="${title.replace(/[<&"]/g, "")}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(tint, pale ? 0.2 : 0.45)}"/><stop offset="1" stop-color="${tint}"/></linearGradient></defs>
${body.replace(/\n\s+/g, "")}
</svg>
`;
}

let count = 0;
for (const product of products) {
  for (const image of product.images) {
    if (!image.placeholder) continue;
    const file = join(root, "public", image.src);
    mkdirSync(dirname(file), { recursive: true });
    const alt = typeof image.alt === "string" ? image.alt : image.alt.en ?? image.alt.es ?? "";
    writeFileSync(file, svg(image.placeholder, alt));
    count++;
  }
}
console.log(`✓ ${count} placeholder images written to public/`);

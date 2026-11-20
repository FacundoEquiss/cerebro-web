#!/usr/bin/env node
// Draws the placeholder product images of the demo catalogue: neutral, flat SVG silhouettes made
// from scratch (no photos, no third-party artwork). It reads content/products.json and every
// preset in content/presets/, and writes one file per image that has a "placeholder" key, into public/. Run it again after editing the demo:
//
//   npm run images
//
// Real stores replace these with photos (WebP/AVIF, see GETTING-STARTED.md) and delete the
// "placeholder" key so this script leaves them alone.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The catalogue in use AND every preset: applying a preset never needs to draw anything.
const sources = ["content/products.json", ...readdirSync(join(root, "content/presets")).filter((f) => f.endsWith(".json")).map((f) => `content/presets/${f}`)];
const products = sources.flatMap((f) => JSON.parse(readFileSync(join(root, f), "utf8")).products);

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
headphones: (c) => `<path d="M230 560C230 300 570 300 570 560" fill="none" stroke="${dark(c, 0.1)}" stroke-width="34" stroke-linecap="round"/>
    <rect x="180" y="520" width="110" height="220" rx="50" fill="${c}"/><rect x="510" y="520" width="110" height="220" rx="50" fill="${c}"/>
    <rect x="198" y="560" width="34" height="140" rx="17" fill="${light(c, 0.3)}"/><rect x="568" y="560" width="34" height="140" rx="17" fill="${light(c, 0.3)}"/>`,
  charger: (c) => `<rect x="300" y="330" width="200" height="250" rx="34" fill="${c}"/><rect x="350" y="270" width="26" height="70" rx="8" fill="${dark(c, 0.35)}"/><rect x="424" y="270" width="26" height="70" rx="8" fill="${dark(c, 0.35)}"/>
    <rect x="372" y="560" width="56" height="34" rx="8" fill="${dark(c, 0.3)}"/><path d="M400 594C400 700 520 660 520 760S400 800 330 800" fill="none" stroke="${dark(c, 0.4)}" stroke-width="16" stroke-linecap="round"/>
    <circle cx="400" cy="450" r="34" fill="${dark(c, 0.12)}"/>`,
  speaker: (c) => `<rect x="240" y="250" width="320" height="540" rx="70" fill="${c}"/><circle cx="400" cy="600" r="112" fill="${dark(c, 0.3)}"/><circle cx="400" cy="600" r="58" fill="${dark(c, 0.5)}"/>
    <circle cx="400" cy="380" r="56" fill="${dark(c, 0.3)}"/><circle cx="400" cy="380" r="24" fill="${dark(c, 0.5)}"/><rect x="262" y="290" width="16" height="130" rx="8" fill="#ffffff" opacity=".25"/>`,
  keyboard: (c) => `<rect x="130" y="400" width="540" height="250" rx="28" fill="${c}"/>${[0, 1, 2].map((r) => Array.from({ length: 9 }, (_, i) => `<rect x="${160 + i * 54}" y="${430 + r * 56}" width="42" height="42" rx="9" fill="${light(c, 0.3 + ((i + r) % 3) * 0.08)}"/>`).join("")).join("")}
    <rect x="268" y="598" width="264" height="30" rx="9" fill="${light(c, 0.4)}"/>`,
  laptop: (c) => `<rect x="190" y="290" width="420" height="450" rx="36" fill="${c}"/><path d="M190 400H610" stroke="${dark(c, 0.18)}" stroke-width="8" stroke-dasharray="18 14"/>
    <rect x="356" y="386" width="88" height="28" rx="10" fill="${dark(c, 0.35)}"/><rect x="230" y="660" width="120" height="44" rx="10" fill="${light(c, 0.3)}"/>`,
  coffee: (c) => `<path d="M270 300H530L560 800H240Z" fill="${c}"/><path d="M270 300H530L522 250H278Z" fill="${dark(c, 0.25)}"/><path d="M258 360H542" stroke="${dark(c, 0.2)}" stroke-width="8"/>
    <rect x="308" y="470" width="184" height="170" rx="14" fill="#ffffff" opacity=".9"/><ellipse cx="400" cy="555" rx="36" ry="52" fill="${dark(c, 0.1)}" transform="rotate(24 400 555)"/><path d="M386 508Q420 555 414 602" fill="none" stroke="#ffffff" stroke-width="7"/>`,
  jar: (c) => `<rect x="300" y="240" width="200" height="70" rx="16" fill="${dark(c, 0.4)}"/><rect x="250" y="300" width="300" height="480" rx="60" fill="${light(c, 0.55)}"/>
    <path d="M250 470H550V720Q550 780 490 780H310Q250 780 250 720Z" fill="${c}"/>${[[320, 520], [400, 500], [470, 540], [350, 600], [440, 620], [300, 680], [500, 690], [400, 700]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="${dark(c, 0.16)}"/>`).join("")}
    <rect x="276" y="340" width="20" height="380" rx="10" fill="#ffffff" opacity=".4"/>`,
  tea: (c) => `<rect x="250" y="330" width="300" height="430" rx="26" fill="${c}"/><ellipse cx="400" cy="330" rx="150" ry="30" fill="${light(c, 0.3)}"/><ellipse cx="400" cy="330" rx="150" ry="30" fill="none" stroke="${dark(c, 0.2)}" stroke-width="6"/>
    <rect x="300" y="470" width="200" height="150" rx="12" fill="#ffffff" opacity=".9"/><path d="M400 500C350 530 350 590 400 600 450 590 450 530 400 500Z" fill="${dark(c, 0.05)}"/><path d="M400 512V596" stroke="#ffffff" stroke-width="5"/>`,
  sack: (c) => `<path d="M270 330C240 520 230 660 262 800H538C570 660 560 520 530 330Z" fill="${c}"/><path d="M270 330C320 300 300 250 330 230H470C500 250 480 300 530 330Z" fill="${dark(c, 0.12)}"/>
    <path d="M300 322H500" stroke="${dark(c, 0.4)}" stroke-width="10" stroke-linecap="round"/><rect x="320" y="480" width="160" height="150" rx="14" fill="#ffffff" opacity=".8"/><path d="M400 505V605M400 530L372 512M400 530L428 512M400 560L372 542M400 560L428 542" stroke="${dark(c, 0.4)}" stroke-width="7" stroke-linecap="round"/>`,
  plate: (c) => `<ellipse cx="400" cy="560" rx="270" ry="210" fill="#fdfcf9"/><ellipse cx="400" cy="560" rx="200" ry="150" fill="${light("#e9e4da", 0.2)}"/>
    ${[[310, 520, -20], [430, 500, 14], [370, 610, 8], [490, 600, -12]].map(([x, y, r]) => `<path d="M${x - 70} ${y}C${x - 70} ${y - 60} ${x + 70} ${y - 60} ${x + 70} ${y}Z" fill="${c}" transform="rotate(${r} ${x} ${y})"/><path d="M${x - 70} ${y}H${x + 70}" stroke="${dark(c, 0.25)}" stroke-width="9" stroke-dasharray="10 9" transform="rotate(${r} ${x} ${y})"/>`).join("")}`,
  pizza: (c) => `<circle cx="400" cy="540" r="250" fill="${dark(c, 0.12)}"/><circle cx="400" cy="540" r="218" fill="${light(c, 0.35)}"/>
    ${[[330, 450], [470, 470], [400, 580], [310, 600], [500, 610], [420, 400]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="34" fill="#b5422d"/>`).join("")}
    <path d="M400 322V758M182 540H618M246 386L554 694M554 386L246 694" stroke="${dark(c, 0.2)}" stroke-width="5"/>`,
  burger: (c) => `<path d="M220 480C220 300 580 300 580 480Z" fill="#d79a4b"/><rect x="204" y="486" width="392" height="34" rx="17" fill="#5f9a4a"/><rect x="214" y="524" width="372" height="66" rx="26" fill="${c}"/>
    <path d="M214 596H586L560 636H240Z" fill="#e6b93f"/><path d="M226 642H574V690Q574 740 524 740H276Q226 740 226 690Z" fill="#d79a4b"/>
    ${[[320, 390], [400, 360], [480, 395], [360, 430], [450, 440]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="10" ry="6" fill="#fff5dc"/>`).join("")}`,
  cake: (c) => `<ellipse cx="400" cy="770" rx="270" ry="36" fill="#fdfcf9"/><path d="M220 520H580V740Q400 790 220 740Z" fill="${c}"/><ellipse cx="400" cy="520" rx="180" ry="46" fill="${light(c, 0.45)}"/>
    <path d="M220 610Q400 660 580 610" fill="none" stroke="${light(c, 0.6)}" stroke-width="16"/><circle cx="400" cy="486" r="30" fill="#b5422d"/><path d="M400 458Q420 420 446 420" fill="none" stroke="#5f9a4a" stroke-width="7"/>`,
  tray: (c) => `<ellipse cx="400" cy="700" rx="300" ry="50" fill="${dark(c, 0.1)}"/><path d="M150 690C150 420 650 420 650 690Z" fill="${light(c, 0.5)}"/><path d="M150 690C150 420 650 420 650 690" fill="none" stroke="${c}" stroke-width="14"/>
    <circle cx="400" cy="462" r="26" fill="${c}"/><path d="M230 640C250 540 330 500 390 494" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" opacity=".6"/>`,
  scissors: (c) => `<circle cx="300" cy="700" r="70" fill="none" stroke="${c}" stroke-width="30"/><circle cx="500" cy="700" r="70" fill="none" stroke="${c}" stroke-width="30"/>
    <path d="M330 640 520 250" stroke="${light(c, 0.5)}" stroke-width="34" stroke-linecap="round"/><path d="M470 640 280 250" stroke="${light(c, 0.35)}" stroke-width="34" stroke-linecap="round"/><circle cx="400" cy="500" r="16" fill="${dark(c, 0.3)}"/>`,
  dryer: (c) => `<rect x="200" y="330" width="330" height="170" rx="80" fill="${c}"/><rect x="520" y="352" width="90" height="126" rx="20" fill="${dark(c, 0.25)}"/><path d="M300 490 250 790H350L390 490Z" fill="${dark(c, 0.12)}"/>
    <circle cx="290" cy="415" r="50" fill="${dark(c, 0.3)}"/><path d="M640 380H700M640 415H720M640 450H700" stroke="${light(c, 0.3)}" stroke-width="12" stroke-linecap="round"/>`,
  calendar: (c) => `<rect x="210" y="300" width="380" height="440" rx="34" fill="#fdfcf9"/><path d="M210 334Q210 300 244 300H556Q590 300 590 334V410H210Z" fill="${c}"/>
    <rect x="290" y="260" width="24" height="84" rx="12" fill="${dark(c, 0.35)}"/><rect x="486" y="260" width="24" height="84" rx="12" fill="${dark(c, 0.35)}"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3].map((i) => `<rect x="${252 + i * 78}" y="${452 + r * 86}" width="54" height="54" rx="12" fill="${r === 1 && i === 2 ? c : "#e9e6df"}"/>`).join("")).join("")}`,
  mat: (c) => `<rect x="170" y="560" width="460" height="150" rx="20" fill="${c}"/><circle cx="210" cy="635" r="76" fill="${dark(c, 0.15)}"/><circle cx="210" cy="635" r="46" fill="${light(c, 0.35)}"/><circle cx="210" cy="635" r="18" fill="${dark(c, 0.3)}"/>
    <path d="M330 560V710M430 560V710M530 560V710" stroke="${dark(c, 0.1)}" stroke-width="6"/><circle cx="520" cy="380" r="54" fill="${light(c, 0.4)}"/><path d="M520 434V520M450 470H590" stroke="${light(c, 0.4)}" stroke-width="22" stroke-linecap="round"/>`,
  camera: (c) => `<rect x="170" y="380" width="460" height="320" rx="44" fill="${c}"/><path d="M310 380 340 320H460L490 380Z" fill="${dark(c, 0.2)}"/><circle cx="400" cy="540" r="112" fill="${light(c, 0.35)}"/><circle cx="400" cy="540" r="76" fill="${dark(c, 0.4)}"/>
    <circle cx="372" cy="512" r="20" fill="#ffffff" opacity=".4"/><rect x="540" y="412" width="54" height="30" rx="10" fill="#e6b93f"/>`,
  ebook: (c) => `<rect x="230" y="230" width="340" height="540" rx="34" fill="${dark(c, 0.45)}"/><rect x="258" y="270" width="284" height="420" rx="8" fill="#fdfcf9"/><circle cx="400" cy="730" r="14" fill="${light(c, 0.3)}"/>
    <rect x="290" y="306" width="150" height="26" rx="6" fill="${c}"/><path d="M290 372H510M290 412H510M290 452H470M290 520H510M290 560H510M290 600H430" stroke="#cfcbc2" stroke-width="12" stroke-linecap="round"/>`,
  file: (c) => `<path d="M250 230H480L570 320V770H250Z" fill="#fdfcf9"/><path d="M480 230V320H570Z" fill="${light(c, 0.3)}"/><rect x="290" y="380" width="240" height="120" rx="12" fill="${light(c, 0.55)}"/>
    <path d="M290 560H530M290 610H530M290 660H440" stroke="#cfcbc2" stroke-width="14" stroke-linecap="round"/><rect x="330" y="700" width="230" height="110" rx="20" fill="${c}"/><path d="M400 730V780M376 760 400 784 424 760M470 730H520M470 756H520M470 782H500" stroke="#ffffff" stroke-width="9" stroke-linecap="round" fill="none"/>`,
  screen: (c) => `<rect x="150" y="290" width="500" height="340" rx="26" fill="${dark(c, 0.3)}"/><rect x="176" y="316" width="448" height="288" rx="8" fill="${light(c, 0.4)}"/><path d="M350 630H450L470 720H330Z" fill="${dark(c, 0.15)}"/><rect x="270" y="720" width="260" height="26" rx="13" fill="${dark(c, 0.3)}"/>
    <circle cx="400" cy="460" r="62" fill="${c}"/><path d="M382 426V494L436 460Z" fill="#ffffff"/>`,
  table: (c) => `<path d="M150 430H650L610 500H190Z" fill="${c}"/><rect x="190" y="500" width="420" height="30" fill="${dark(c, 0.2)}"/><path d="M220 530H256V800H236ZM544 530H580L564 800H544ZM300 530H326V720H312ZM474 530H500L488 720H474Z" fill="${dark(c, 0.3)}"/>
    <path d="M200 452H600" stroke="${light(c, 0.4)}" stroke-width="6"/>`,
  box: (c) => `<path d="M200 420 400 340 600 420V700L400 790 200 700Z" fill="${c}"/><path d="M200 420 400 500 600 420 400 340Z" fill="${light(c, 0.3)}"/><path d="M400 500V790" stroke="${dark(c, 0.2)}" stroke-width="6"/>
    <path d="M300 380 500 460V540" fill="none" stroke="${dark(c, 0.3)}" stroke-width="20"/>`,

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

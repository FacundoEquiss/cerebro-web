#!/usr/bin/env node
// Writes the EXAMPLE files of the digital products of the presets: tiny, harmless PDFs made from
// scratch, in content/downloads/. They are NOT under public/: a digital file is only handed over
// through /api/downloads/… to a paid order (see docs/product-types.md).
//
//   npm run samples
//
// A real store uploads its files from the admin panel; they go to the private storage.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "downloads");

/** A one-page PDF with a title and a few lines of text. */
function pdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, "\\$&");
  const text = [`BT /F1 26 Tf 72 720 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 13 Tf 72 ${670 - i * 24} Td (${esc(l)}) Tj ET`)].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

const note = ["This is an EXAMPLE file. It stands in for the real product.", "Replace it from the admin panel: Products > the product > File.", "", "Este es un archivo de EJEMPLO. Reemplazalo por el archivo real", "desde el panel: Productos > el producto > Archivo."];
const files = {
  "sample-guide.pdf": pdf("Example guide", note),
  "sample-templates.pdf": pdf("Example templates", note),
  "sample-course.pdf": pdf("Example course", note),
};
mkdirSync(out, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content, "latin1");
console.log(`✓ ${Object.keys(files).length} example downloads written to content/downloads/`);

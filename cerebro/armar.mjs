#!/usr/bin/env node
// Arma el Cerebro Web: lee datos.json + plantilla.html y escribe dist/, la carpeta lista para publicar.
//
//   node cerebro/armar.mjs
//   BASE_URL=https://example.com node cerebro/armar.mjs
//   node cerebro/armar.mjs --datos otro.json --salida /tmp/prueba     (para probar)
//
// Sin dependencias. FALLA (y no escribe nada) si encuentra una palabra prohibida, un id repetido o mal
// formado, un campo obligatorio vacío, o una prioridad o fase que no conoce.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aca = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const rutaDatos = resolve(arg('datos', join(aca, 'datos.json')));
const dist = resolve(arg('salida', join(aca, 'dist')));
const BASE = String(process.env.BASE_URL || 'https://cerebro-web-negocios.vercel.app').replace(/\/+$/, '');
const fallar = m => { console.error('✗ ' + m); process.exit(1); };

/* ================= palabras prohibidas =================
   Quien deriva este cerebro de un proyecto privado no quiere que nada de aquella marca llegue a lo publicado.
   La lista de términos NO vive en el repositorio (ni codificada ni en forma de hash: todo eso se revierte):
   se lee de un archivo LOCAL, ignorado por git, con un término por línea. Una línea que empieza con "=" se
   busca sólo como palabra entera; "#" es un comentario. El archivo es `.brand-blocklist` en la raíz del
   repositorio, o el que indique la variable BRAND_BLOCKLIST_FILE. Si no existe, se revisan sólo los patrones
   genéricos de abajo (ids de cuentas, teléfonos, correos) y se avisa. */
function leerLista() {
  const candidatos = [process.env.BRAND_BLOCKLIST_FILE, join(aca, '..', '.brand-blocklist'), join(aca, '.brand-blocklist')].filter(Boolean);
  const ruta = candidatos.find(r => existsSync(r));
  if (!ruta) return { ruta: null, partes: [], enteras: [] };
  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  return { ruta, partes: lineas.filter(l => !l.startsWith('=')), enteras: lineas.filter(l => l.startsWith('=')).map(l => l.slice(1).trim()).filter(Boolean) };
}
const LISTA = leerLista();
const PROHIBIDAS = LISTA.partes, PROHIBIDAS_ENTERAS = LISTA.enteras;
if (!LISTA.ruta) console.warn('• Sin lista local de palabras prohibidas (.brand-blocklist): se revisan sólo los patrones genéricos.');
const PATRONES = [
  [/\d{11,}/, 'número largo (¿un id de cuenta o un teléfono?)'],
  [/\bG-[A-Z0-9]{8,}\b/, 'id de medición'],
  [/\b(?:prj|team)_[A-Za-z0-9]{12,}\b/, 'id de proyecto'],
  [/[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/, 'dirección de correo que no es de example.com'],
  [/\b[a-z0-9]{20}\.supabase\.co\b/, 'dirección de un proyecto de base de datos']
];
const llano = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// LA ÚNICA mención permitida: la dirección pública de este repositorio (igual que en
// scripts/check-brand.mjs; escrita en dos mitades para no tropezar con su propia regla).
const REPOSITORIO_PUBLICO = new RegExp(['Fac', 'undoEquiss/cerebro-web'].join('').replace('/', '\\/'), 'gi');
function prohibidasEn(textoCrudo) {
  const texto = String(textoCrudo).replace(REPOSITORIO_PUBLICO, '');
  const t = llano(texto), halladas = [];
  for (const [i, p] of PROHIBIDAS.entries()) if (t.includes(llano(p))) halladas.push(`término ${i + 1} de la lista local`);
  for (const p of PROHIBIDAS_ENTERAS) if (new RegExp('(^|[^a-z0-9])' + llano(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(t)) halladas.push(`palabra entera ${PROHIBIDAS_ENTERAS.indexOf(p) + 1} de la lista local`);
  for (const [re, que] of PATRONES) { const m = String(texto).match(re); if (m) halladas.push(`${que}: «${m[0]}»`); }
  return halladas;
}

/* ================= datos ================= */
let datos;
try { datos = JSON.parse(readFileSync(rutaDatos, 'utf8')); } catch (e) { fallar(`No se pudo leer ${rutaDatos}: ${e.message}`); }
if (!datos || !datos.raiz || !Array.isArray(datos.raiz.hijos)) fallar('datos.json tiene que ser { generado, version, raiz: { id, titulo, resumen, para_que, hijos: [...] } }');

const PRIORIDADES = { esencial: 'Esencial', recomendado: 'Recomendado', opcional: 'Opcional', avanzado: 'Avanzado' };
const FASES = { antes: 'Antes de construir', construccion: 'Construcción', lanzamiento: 'Lanzamiento', crecimiento: 'Crecimiento' };
const NUM_FASE = { antes: 1, construccion: 2, lanzamiento: 3, crecimiento: 4 };
const RESERVADOS = new Set(['contenido', 'indice', 'inicio', 'arriba', 'agentes']);   // ids que usa la guía

const errores = [], avisos = [], ids = new Set(), porNivel = [], todos = [];
const lleno = v => typeof v === 'string' && v.trim().length > 0;
const listaLlena = v => Array.isArray(v) && v.length > 0 && v.every(lleno);
(function ver(n, prof, camino) {
  porNivel[prof] = (porNivel[prof] || 0) + 1;
  const donde = `${camino} › ${n.titulo ?? n.id ?? '¿?'}`;
  if (!lleno(n.id)) errores.push(`sin id: ${donde}`);
  else {
    if (!/^[a-z][a-z0-9-]*$/.test(n.id)) errores.push(`id mal formado "${n.id}" (minúsculas, números y guiones): ${donde}`);
    if (ids.has(n.id)) errores.push(`id repetido "${n.id}": ${donde}`);
    if (RESERVADOS.has(n.id)) errores.push(`id reservado "${n.id}": ${donde}`);
    ids.add(n.id);
  }
  for (const c of ['titulo', 'resumen', 'para_que']) if (!lleno(n[c])) errores.push(`"${c}" vacío: ${donde}`);
  if (prof > 0) {
    todos.push(n);
    if (!listaLlena(n.como)) errores.push(`"como" vacío (lista de pasos): ${donde}`);
    if (!listaLlena(n.herramientas)) errores.push(`"herramientas" vacío: ${donde}`);
    if (!lleno(n.error_comun)) errores.push(`"error_comun" vacío: ${donde}`);
    if (!PRIORIDADES[n.prioridad]) errores.push(`prioridad desconocida "${n.prioridad}": ${donde}`);
    if (!FASES[n.fase]) errores.push(`fase desconocida "${n.fase}": ${donde}`);
    if (!lleno(n.categoria)) errores.push(`"categoria" vacía (el id de su rama): ${donde}`);
  }
  if (lleno(n.titulo) && n.titulo.length > 28) avisos.push(`título de ${n.titulo.length} car. (máx. 28): ${donde}`);
  if (lleno(n.resumen) && n.resumen.length > 140) avisos.push(`resumen de ${n.resumen.length} car. (máx. 140): ${donde}`);
  if (n.hijos != null && !Array.isArray(n.hijos)) errores.push(`"hijos" no es una lista: ${donde}`);
  for (const h of n.hijos || []) ver(h, prof + 1, prof ? donde : 'inicio');
})(datos.raiz, 0, '');
const ramas = datos.raiz.hijos;
for (const n of todos) if (lleno(n.categoria) && !ramas.some(r => r.id === n.categoria)) errores.push(`categoría "${n.categoria}" no es el id de ninguna rama: ${n.id}`);
for (const p of prohibidasEn(JSON.stringify(datos))) errores.push(`palabra prohibida en datos.json: ${p}`);
if (errores.length) { console.error(`✗ ${errores.length} error(es) en ${rutaDatos}:`); for (const e of errores.slice(0, 60)) console.error('   - ' + e); process.exit(1); }

/* ================= textos comunes ================= */
const R = datos.raiz;
const TITULO = 'Cerebro Web: guía completa para construir la web de un negocio';
const DESCRIPCION = `Mapa mental con ${todos.length} nodos accionables para construir, lanzar y hacer crecer la web de un negocio: tienda, pagos, SEO, IA, medición, publicidad y redes. Para agentes de IA y personas.`;
const INSTRUCCIONES = [
  'Leer primero la rama «Cómo usar este cerebro» completa.',
  'Seguir el orden de fases: 1 antes de construir, 2 construcción, 3 lanzamiento, 4 crecimiento. Dentro de cada fase, hacer primero lo «esencial».',
  'Adaptar cada recomendación al negocio concreto (rubro, país, tamaño, presupuesto). Descartar las ramas que no aplican.',
  'Deducir todo lo posible del repositorio, la web y las cuentas existentes; preguntar al dueño sólo lo que no se pueda deducir, en una sola tanda.',
  'Nunca inventar datos del negocio: precios, plazos, reseñas, direcciones, cuotas, stock ni resultados. Lo que falta se marca como pendiente.',
  'Verificar antes de dar algo por hecho: pruebas, capturas en móvil y escritorio, y el flujo real (por ejemplo, una compra de punta a punta).',
  'Pedir aprobación antes de publicar, gastar dinero, enviar mensajes o modificar datos de producción.',
  'Confirmar contra la documentación oficial vigente todo lo que dependa de un panel o una API: las plataformas cambian.'
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rico = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');          // `así` sale en monoespaciada
const meta = n => `Prioridad: ${PRIORIDADES[n.prioridad].toLowerCase()} · Fase ${NUM_FASE[n.fase]}: ${FASES[n.fase].toLowerCase()}`;

/* ================= Markdown (llms-full.txt) ================= */
function mdNodo(n, prof) {
  let s = `${'#'.repeat(Math.min(prof + 1, 6))} ${n.titulo}\n\n`;
  s += `\`${n.id}\` · ${meta(n)}\n\n${n.resumen}\n\n`;
  s += `**Para qué sirve:** ${n.para_que}\n\n**Cómo se hace:**\n\n${n.como.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n`;
  s += `**Herramientas / dónde se hace:** ${n.herramientas.join(' · ')}\n\n**Error común / regla de oro:** ${n.error_comun}\n\n`;
  for (const h of n.hijos || []) s += mdNodo(h, prof + 1);
  return s;
}
// DÓNDE ESTÁ EL CÓDIGO. El cerebro es la guía; la plantilla que la aplica vive en un repositorio y
// tiene una demo publicada. Un solo lugar para esos enlaces: `enlaces` en datos.json.
const ENLACES = datos.enlaces || {};
if (!/^https:\/\//.test(ENLACES.repositorio || '') || !/^https:\/\//.test(ENLACES.demo || '')) fallar('datos.json tiene que traer `enlaces.repositorio` y `enlaces.demo`');
const PLANTILLA_MD = `## La plantilla que aplica esta guía

Este cerebro es la guía de **Cerebro Web**, una base de tienda de código abierto (Next.js): tienda, panel de gestión y esta guía, en un repositorio que queda en manos del negocio.

- Código (MIT): ${ENLACES.repositorio}
- Demo en vivo: ${ENLACES.demo}
- Para empezar: clonar el repositorio y seguir su \`AGENTS.md\` y su \`GETTING-STARTED.md\`.${ENLACES.crear ? ` Creador en un comando: \`${ENLACES.crear}\`. ${ENLACES.crear_estado || ''}` : ''}
`;
const llmsFull = `# Cerebro Web

> ${R.resumen}

${R.para_que}

Versión ${datos.version || ''} · actualizado el ${datos.generado || ''} · ${ramas.length} ramas · ${todos.length} nodos · Fuente: ${BASE}/

${PLANTILLA_MD}
## Instrucciones para el agente

${INSTRUCCIONES.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Cada nodo trae: identificador, prioridad (esencial, recomendado, opcional, avanzado), fase (1 antes de construir, 2 construcción, 3 lanzamiento, 4 crecimiento), qué es, para qué sirve, cómo se hace, herramientas o dónde se hace, y el error común o la regla de oro. Los ejemplos usan \`example.com\`, «tu marca» y «tu CRM»: se reemplazan por los datos reales confirmados.

## Índice de ramas

${ramas.map((r, i) => `${i + 1}. ${r.titulo} — ${r.resumen}`).join('\n')}

---

${ramas.map(r => mdNodo(r, 1)).join('---\n\n')}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

/* ================= llms.txt (formato de llmstxt.org) ================= */
const llms = `# Cerebro Web

> ${R.resumen}

Es una guía genérica y reutilizable: ${ramas.length} ramas y ${todos.length} nodos, cada uno con qué es, para qué sirve, cómo se hace, herramientas, error común, prioridad y fase. No contiene datos de ningún negocio concreto.

${PLANTILLA_MD}
Instrucciones para agentes:

${INSTRUCCIONES.map(t => `- ${t}`).join('\n')}

## Contenido completo

- [Todo el cerebro en Markdown](${BASE}/llms-full.txt): el contenido íntegro en un solo archivo; empieza por las instrucciones para el agente
- [Guía legible](${BASE}/guia): el mismo contenido como documento HTML, con índice y un ancla por nodo
- [Datos en JSON](${BASE}/cerebro.json): el árbol completo con todos los campos
- [Mapa interactivo](${BASE}/): mapa mental navegable; el HTML incluye todo el texto sin necesidad de JavaScript

## Ramas

${ramas.map(r => `- [${r.titulo}](${BASE}/guia#${r.id}): ${r.resumen}`).join('\n')}

## Optional

- [Mapa del sitio](${BASE}/sitemap.xml): las direcciones publicadas
`;

/* ================= HTML del contenido ================= */
// conIds: en la guía cada nodo lleva su id como ancla; en el mapa interactivo no (chocarían con los ids del motor).
function htmlNodo(n, prof, conIds) {
  const h = Math.min(prof + 1, 6);
  let s = conIds ? `<section id="${esc(n.id)}" class="nodo n${prof}">\n` : `<section data-nodo="${esc(n.id)}">\n`;
  s += `<h${h}>${esc(n.titulo)}${conIds ? ` <a class="ancla" href="#${esc(n.id)}" aria-label="Enlace a ${esc(n.titulo)}">#</a>` : ''}</h${h}>\n`;
  s += `<p class="meta">${conIds ? `<span class="pri ${n.prioridad}">${PRIORIDADES[n.prioridad]}</span> <span class="fase">Fase ${NUM_FASE[n.fase]} · ${FASES[n.fase]}</span> <code>${esc(n.id)}</code> <a href="../index.html#${esc(n.id)}">ver en el mapa</a>` : `${esc(meta(n))} · id: ${esc(n.id)}`}</p>\n`;
  s += `<p class="resumen">${rico(n.resumen)}</p>\n<p><strong>Para qué sirve:</strong> ${rico(n.para_que)}</p>\n`;
  s += `<p><strong>Cómo se hace:</strong></p>\n<ol>${n.como.map(p => `<li>${rico(p)}</li>`).join('')}</ol>\n`;
  s += `<p><strong>Herramientas / dónde se hace:</strong></p>\n<ul>${n.herramientas.map(p => `<li>${rico(p)}</li>`).join('')}</ul>\n`;
  s += `<p class="error"><strong>Error común / regla de oro:</strong> ${rico(n.error_comun)}</p>\n`;
  for (const k of n.hijos || []) s += htmlNodo(k, prof + 1, conIds);
  return s + '</section>\n';
}
const htmlInstrucciones = `<ol>${INSTRUCCIONES.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`;
const textoMapa = `<h1>${esc(TITULO)}</h1>
<p>${esc(R.resumen)}</p>
<p>${esc(R.para_que)}</p>
<p>Versión ${esc(datos.version || '')}, actualizado el ${esc(datos.generado || '')}. ${ramas.length} ramas y ${todos.length} nodos. El mismo contenido en otros formatos: ${BASE}/llms-full.txt (Markdown), ${BASE}/guia (documento con índice), ${BASE}/cerebro.json (datos) y ${BASE}/llms.txt (resumen y enlaces).</p>
<h2>La plantilla que aplica esta guía</h2>
<p>Este cerebro es la guía de Cerebro Web, una base de tienda de código abierto (Next.js). Código (MIT): <a href="${esc(ENLACES.repositorio)}">${esc(ENLACES.repositorio)}</a>. Demo en vivo: <a href="${esc(ENLACES.demo)}">${esc(ENLACES.demo)}</a>.</p>
<h2>Instrucciones para el agente</h2>
${htmlInstrucciones}
<h2>Índice de ramas</h2>
<ol>${ramas.map(r => `<li>${esc(r.titulo)}: ${esc(r.resumen)}</li>`).join('')}</ol>
${ramas.map(r => htmlNodo(r, 1, false)).join('')}`;

/* ================= index.html ================= */
const plantilla = readFileSync(join(aca, 'plantilla.html'), 'utf8');
for (const m of ['__CEREBRO_DATOS__', '__CEREBRO_TEXTO__']) if (plantilla.split(m).length !== 2) fallar(`plantilla.html tiene que tener el marcador ${m} exactamente una vez`);
// Escapado para que el JSON viva sin riesgo adentro de un <script>.
const json = JSON.stringify(datos).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
const index = plantilla.replace('__CEREBRO_DATOS__', () => json).replace('__CEREBRO_TEXTO__', () => textoMapa)
  .split('__TITULO__').join(esc(TITULO)).split('__DESCRIPCION__').join(esc(DESCRIPCION)).split('__BASE_URL__').join(BASE)
  .split('__REPO_URL__').join(esc(ENLACES.repositorio)).split('__DEMO_URL__').join(esc(ENLACES.demo));

/* ================= guia/index.html ================= */
const indiceGuia = `<ol>${ramas.map(r => `<li><a href="#${r.id}">${esc(r.titulo)}</a>${(r.hijos || []).length ? `<ul>${r.hijos.map(k => `<li><a href="#${k.id}">${esc(k.titulo)}</a></li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`;
const guia = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guía en texto · ${esc(TITULO)}</title>
<meta name="description" content="${esc(DESCRIPCION)}">
<link rel="canonical" href="${BASE}/guia">
<meta name="robots" content="index,follow,max-snippet:-1">
<meta property="og:type" content="article">
<meta property="og:title" content="Guía en texto · ${esc(TITULO)}">
<meta property="og:description" content="${esc(DESCRIPCION)}">
<meta property="og:url" content="${BASE}/guia">
<meta property="og:image" content="${BASE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f7f8fc">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="${BASE}/llms-full.txt">
<link rel="alternate" type="application/json" href="${BASE}/cerebro.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{--fondo:#f7f8fc;--papel:#fff;--tinta:#0b1020;--texto:#1c2540;--texto-2:#55607c;--linea:#e2e6f0;--acento:#4a5be0;--suave:#eef0fb;
  --f-display:"Instrument Serif","Iowan Old Style",Georgia,serif;--f-ui:"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif;
  --f-texto:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--fondo:#0b1020;--papel:#141b30;--tinta:#eef2fb;--texto:#dfe5f5;--texto-2:#a3aeca;--linea:#293556;--acento:#9aa8ff;--suave:#1d2742}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--fondo);color:var(--texto);font:16px/1.6 var(--f-texto)}
a{color:var(--acento)}
a:focus-visible{outline:2px solid var(--acento);outline-offset:2px;border-radius:3px}
.pagina{max-width:860px;margin:0 auto;padding:28px 20px 80px}
header.cab{padding:26px 0 8px}
.sobre{font:500 12px var(--f-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--texto-2);margin:0 0 6px}
h1{font:400 clamp(34px,6vw,52px)/1.05 var(--f-display);color:var(--tinta);margin:0 0 14px;letter-spacing:-.005em}
h1 em{color:var(--acento)}
.bajada{font-size:18px;color:var(--texto);margin:0 0 10px}
.formatos{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0;padding:0;list-style:none}
.formatos a{display:inline-block;padding:7px 12px;border-radius:999px;background:var(--suave);text-decoration:none;font:500 13.5px var(--f-mono)}
.caja{background:var(--papel);border-radius:18px;padding:20px 22px;margin:22px 0;box-shadow:0 1px 2px rgba(11,16,32,.06)}
.caja h2{margin-top:0}
h2{font:400 32px/1.1 var(--f-display);color:var(--tinta);margin:0 0 10px}
h3{font:600 21px/1.2 var(--f-ui);letter-spacing:.01em;color:var(--tinta);margin:0 0 8px}
h4{font:600 17px/1.25 var(--f-texto);color:var(--tinta);margin:0 0 6px}
h5{font:600 15.5px/1.3 var(--f-texto);color:var(--tinta);margin:0 0 6px}
nav.indice ol{margin:0;padding-left:22px;columns:2;column-gap:32px}
nav.indice ol>li{break-inside:avoid;margin:0 0 10px;font-weight:600}
nav.indice ul{margin:3px 0 0;padding-left:16px;font-weight:400;font-size:14.5px;list-style:none}
nav.indice a{text-decoration:none}
nav.indice a:hover{text-decoration:underline}
@media (max-width:640px){nav.indice ol{columns:1}}
section.nodo{scroll-margin-top:14px}
section.n1{margin:44px 0 0;padding-top:26px;border-top:2px solid var(--tinta)}
section.n2{margin:26px 0 0;padding:18px 0 0;border-top:1px solid var(--linea)}
section.n3,section.n4,section.n5{margin:16px 0 0;padding:14px 16px;background:var(--papel);border-radius:14px;box-shadow:0 1px 2px rgba(11,16,32,.05)}
section.n4,section.n5{background:var(--suave);box-shadow:none}
.ancla{font:400 .7em var(--f-mono);color:var(--texto-2);text-decoration:none;opacity:.45}
.ancla:hover,.ancla:focus-visible{opacity:1}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 8px;font-size:13px;color:var(--texto-2)}
.pri,.fase{font:600 11.5px var(--f-ui);letter-spacing:.09em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:var(--suave);color:var(--texto)}
.pri.esencial{background:#ffe9a6;color:#4a3500}.pri.recomendado{background:#c9f5dc;color:#0d4a2b}.pri.opcional{background:#d3ebff;color:#0c3a63}.pri.avanzado{background:#e6d8ff;color:#3b1d7a}
code{font:500 .86em var(--f-mono);background:var(--suave);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.resumen{font-size:17px;margin:0 0 8px;color:var(--tinta)}
p{margin:0 0 8px}
ol,ul{margin:0 0 10px;padding-left:22px}
li{margin:2px 0}
.error{background:var(--suave);border-left:3px solid var(--acento);padding:9px 12px;border-radius:0 10px 10px 0}
.arriba{position:fixed;right:16px;bottom:16px;background:var(--tinta);color:var(--fondo);text-decoration:none;font:600 13px var(--f-ui);letter-spacing:.08em;text-transform:uppercase;padding:9px 14px;border-radius:999px}
footer{margin-top:50px;padding-top:18px;border-top:1px solid var(--linea);font-size:14px;color:var(--texto-2)}
@media print{.arriba,.formatos{display:none}body{background:#fff}}
</style>
</head>
<body>
<div class="pagina" id="arriba">
<header class="cab">
<p class="sobre">Guía en texto · v${esc(datos.version || '')} · actualizada el ${esc(datos.generado || '')}</p>
<h1>Cerebro <em>Web</em></h1>
<p class="bajada">${esc(R.resumen)}</p>
<p>${esc(R.para_que)}</p>
<ul class="formatos">
<li><a href="../index.html">mapa interactivo</a></li>
<li><a href="../llms-full.txt">llms-full.txt</a></li>
<li><a href="../cerebro.json">cerebro.json</a></li>
<li><a href="../llms.txt">llms.txt</a></li>
</ul>
</header>
<main id="contenido">
<div class="caja" id="agentes">
<h2>Instrucciones para el agente</h2>
${htmlInstrucciones}
<p>Cada nodo trae su prioridad (esencial, recomendado, opcional, avanzado), su fase (1 antes de construir, 2 construcción, 3 lanzamiento, 4 crecimiento), para qué sirve, cómo se hace, las herramientas o el lugar donde se hace y el error común o la regla de oro. Cada nodo tiene un ancla con su identificador: <code>${BASE}/guia#identificador</code>.</p>
</div>
<nav class="caja indice" id="indice" aria-label="Índice">
<h2>Índice · ${ramas.length} ramas, ${todos.length} nodos</h2>
${indiceGuia}
</nav>
${ramas.map(r => htmlNodo(r, 1, true)).join('')}
</main>
<footer><p>Cerebro Web · guía genérica, sin datos de ningún negocio concreto. Las plataformas cambian: confirmar cada integración contra su documentación oficial vigente.</p></footer>
</div>
<a class="arriba" href="#indice">Índice</a>
</body>
</html>
`;

/* ================= archivos chicos ================= */
const robots = `# Todo el contenido es público. Los buscadores y los rastreadores de asistentes de IA
# (de búsqueda y de entrenamiento) son bienvenidos: la regla general los cubre a todos.
User-agent: *
Allow: /

Sitemap: ${BASE}/sitemap.xml
`;
const hoy = /^\d{4}-\d{2}-\d{2}$/.test(datos.generado || '') ? datos.generado : new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/guia', '/llms-full.txt', '/llms.txt', '/cerebro.json'].map(u => `  <url><loc>${BASE}${u}</loc><lastmod>${hoy}</lastmod></url>`).join('\n')}
</urlset>
`;
const cabeceras = (tipo) => [{ key: 'Content-Type', value: tipo }, { key: 'Access-Control-Allow-Origin', value: '*' }];
const vercel = JSON.stringify({
  cleanUrls: true,
  trailingSlash: false,
  headers: [
    { source: '/(.*)', headers: [
      { key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' }
    ] },
    { source: '/(.*)\\.txt', headers: cabeceras('text/plain; charset=utf-8') },
    { source: '/(.*)\\.json', headers: cabeceras('application/json; charset=utf-8') },
    { source: '/sitemap.xml', headers: [{ key: 'Content-Type', value: 'application/xml; charset=utf-8' }] }
  ]
}, null, 2) + '\n';
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1020"/><g stroke="#9aa8ff" stroke-width="2.5" stroke-linecap="round"><path d="M32 32 14 16M32 32l19-13M32 32l17 18M32 32 15 49"/></g><circle cx="14" cy="16" r="5" fill="#f6c56e"/><circle cx="51" cy="19" r="5" fill="#4fd6c4"/><circle cx="49" cy="50" r="5" fill="#f58ad6"/><circle cx="15" cy="49" r="5" fill="#7aa7ff"/><circle cx="32" cy="32" r="10" fill="#cdd5ff"/></svg>
`;

/* ================= control final y escritura ================= */
const salidas = {
  'index.html': index, 'guia/index.html': guia, 'llms.txt': llms, 'llms-full.txt': llmsFull,
  'cerebro.json': JSON.stringify(datos, null, 1) + '\n', 'robots.txt': robots, 'sitemap.xml': sitemap, 'vercel.json': vercel, 'favicon.svg': favicon
};
const sucias = [];
for (const [nombre, contenido] of Object.entries(salidas)) {
  const cuerpo = nombre === 'index.html' ? contenido.replace(/\\u003c/g, '<') : contenido;
  for (const p of new Set(prohibidasEn(cuerpo))) sucias.push(`${nombre}: ${p}`);
}
if (sucias.length) { console.error(`✗ ${sucias.length} palabra(s) prohibida(s) en lo generado. No se escribió nada:`); for (const e of sucias.slice(0, 60)) console.error('   - ' + e); process.exit(1); }
if (!/<main[^>]*id="contenido"/.test(index)) fallar('el index quedó sin su <main id="contenido">');
for (const n of todos) if (!index.includes(`data-nodo="${n.id}"`) || !guia.includes(`id="${n.id}"`) || !llmsFull.includes('`' + n.id + '`')) fallar(`el nodo "${n.id}" no llegó a todas las salidas`);

mkdirSync(join(dist, 'guia'), { recursive: true });
const pesos = [];
for (const [nombre, contenido] of Object.entries(salidas)) { writeFileSync(join(dist, nombre), contenido); pesos.push([nombre, Buffer.byteLength(contenido)]); }
const og = join(aca, 'assets', 'og.png');           // la imagen para compartir es un binario: se copia tal cual
if (existsSync(og)) { copyFileSync(og, join(dist, 'og.png')); pesos.push(['og.png', readFileSync(og).length]); }
else avisos.push('falta assets/og.png (la imagen para compartir): el index la referencia');

console.log(`✓ ${dist}   (BASE_URL = ${BASE})`);
console.log(`  ${ramas.length} ramas · ${todos.length} nodos · por nivel: ${porNivel.join(' / ')} · ${PROHIBIDAS.length + PROHIBIDAS_ENTERAS.length} palabras prohibidas controladas`);
for (const [n, b] of pesos) console.log(`  ${n.padEnd(18)} ${(b / 1024).toFixed(1).padStart(7)} KB`);
if (avisos.length) { console.log(`  ${avisos.length} aviso(s):`); for (const a of avisos.slice(0, 40)) console.log('   - ' + a); }

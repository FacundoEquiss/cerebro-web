# Cerebro Web (genérico)

Mapa mental interactivo con todo lo que hace falta para **construir, lanzar y hacer crecer la web de un
negocio**: estrategia, stack, tienda, checkout, multimedia, SEO, buscadores con IA, medición, publicidad,
redes, seguridad, calidad y trabajo con agentes de IA. Es **genérico**: no nombra ninguna marca ni trae
datos de ningún negocio. Está pensado para que lo lean agentes de IA (y personas): al empezar otra web, se
le indica al agente que lea `https://<dominio>/llms-full.txt`.

## Archivos

| Archivo | Qué es |
|---|---|
| `datos.json` | La única fuente de contenido. Se edita a mano. |
| `plantilla.html` | El motor del mapa (HTML + CSS + JS, sin librerías). |
| `armar.mjs` | Genera `dist/`. Node sin dependencias. |
| `assets/og.png` | Imagen para compartir (1200 × 630); se copia tal cual. |
| `dist/` | Lo que se publica. **No editar a mano: se pisa.** |

## Cómo se actualiza

1. Editar `datos.json`.
2. `node cerebro/armar.mjs` (con otro dominio: `BASE_URL=https://example.com node …`).

Cada nodo lleva: `id` (minúsculas y guiones, único), `titulo` (≤ 28 caracteres), `categoria` (el id de su
rama), `resumen` (≤ 140), `para_que`, `como` (lista de pasos), `herramientas` (lista), `error_comun`,
`prioridad` (`esencial` · `recomendado` · `opcional` · `avanzado`), `fase` (`antes` · `construccion` ·
`lanzamiento` · `crecimiento`) e `hijos`. Lo que va entre comillas invertidas sale en monoespaciada.

El script **falla y no escribe nada** si encuentra un id repetido o mal formado, un campo obligatorio vacío,
una prioridad o fase desconocida, un patrón de datos privados (ids de cuentas, teléfonos, correos que no sean
de `example.com`) o una **palabra prohibida**.

La lista de palabras prohibidas **no está en el repositorio**: es un archivo local, `.brand-blocklist` en la
raíz (o el que indique `BRAND_BLOCKLIST_FILE`), ignorado por git, con un término por línea (`=palabra` para
buscarla sólo como palabra entera, `#` para comentarios). Sirve a quien deriva el cerebro o la plantilla de
un proyecto propio y no quiere que se le escape su marca. Sin ese archivo se revisan sólo los patrones
genéricos y el script lo avisa.

## Qué genera

`index.html` (mapa interactivo + todo el contenido como texto en un `<main>` oculto a la vista, legible sin
JavaScript) · `guia/index.html` (documento con índice y un ancla por nodo) · `llms.txt` · `llms-full.txt` ·
`cerebro.json` · `robots.txt` · `sitemap.xml` · `vercel.json` · `favicon.svg` · `og.png`.

## Cómo se publica

En Vercel, proyecto nuevo con **Root Directory = `cerebro/dist`**, sin framework ni comando de
build (o `vercel deploy --prod` desde esa carpeta). Si el dominio final no es
`https://cerebro-web-negocios.vercel.app`, volver a generar con `BASE_URL` y subir de nuevo.

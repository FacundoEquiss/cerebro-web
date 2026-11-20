[English](AGENTS.md) · **Español**

# Instrucciones para agentes

Estás trabajando en **Cerebro Web**, o en la web de un negocio hecha a partir de él: una tienda en
Next.js + un panel de gestión + una guía («el cerebro»). El dueño del negocio no programa. Te va a
pedir resultados («adaptá esto a mi negocio», «sumá envío gratis desde X»); vos hacés el trabajo
**y lo verificás**.

## 0. Primero, el cerebro

`cerebro/` tiene la guía para construir, lanzar y hacer crecer la web de un negocio (334 nodos).
Antes de tu primer cambio:

1. Leé `cerebro/dist/llms-full.txt` — como mínimo las ramas **«Cómo usar este cerebro»** y
   **«Adaptar a tu rubro»** (qué preset y qué tipo de producto le corresponden al negocio) y los
   nodos **esenciales** de la fase en la que estás. (En línea: <https://cerebro-web-negocios.vercel.app/llms-full.txt>.)
2. Leé [`GETTING-STARTED.es.md`](GETTING-STARTED.es.md): el checklist ordenado para convertir esta
   plantilla en una web real, separando lo que hacés vos de lo que sólo puede hacer el dueño. Para
   salir a vender —base de datos, variables, usuario del panel, cobros, correo y dominio— seguí
   [`docs/go-live.es.md`](docs/go-live.es.md) y corré `npm run doctor` después de cada paso.
3. Volvé acá por las reglas de este código.

Si el cerebro y una costumbre tuya no coinciden, gana el cerebro. Si el cerebro y el **código** no
coinciden, revisá el código: es lo que corre.

## 1. Reglas que valen siempre

1. **Nunca inventes datos del negocio.** Si falta el PRECIO de un producto, cargalo como **borrador**
   (`"price": null`, o la casilla de borrador del panel): no se vende ni se muestra, y
   `npm run check:catalog` lo lista para llevárselo al dueño. Nunca un importe de relleno. Precios, stock, direcciones, horarios, costos de envío,
   políticas de cambio, reseñas, cuotas: si el dueño no te lo dio, va `null`, «COMPLETAR» o una
   pregunta para él. La plantilla está llena de textos marcados EJEMPLO a propósito.
2. **El precio lo pone el servidor.** El navegador manda ids de productos y cantidades. Los
   totales se calculan en `lib/orders/pricing.ts` o en `create_order()` (`db/schema.sql`). Nunca
   confíes, guardes ni reenvíes un monto que vino de un navegador.
3. **Una sola fuente para cada dato.** Marca, contacto y colores: `config/brand.ts`. Envíos,
   mínimos y plazos: `config/commerce.ts`. Textos: `i18n/`. Rutas: `i18n/routes.ts`. Si el mismo
   número está escrito en dos lugares, en uno ya está mal.
4. **Sólo a través de los adaptadores.** Las páginas y las rutas nunca importan un cliente de base
   de datos: llaman a `lib/data` (y a `lib/payments`, `lib/mail`, `lib/storage`). Ver
   [`docs/adapters.es.md`](docs/adapters.es.md).
5. **Cada página y cada ruta del panel verifica la sesión por su cuenta** (`getSession`,
   `requireAdmin`, `requireWriter` en `lib/admin/auth.ts`). El proxy es una primera barrera, no la
   única.
6. **La medición está apagada fuera de producción** y nunca corre sin el consentimiento del
   visitante. El evento `purchase` lo manda el servidor, una sola vez por pedido, con el id del
   pedido como `event_id`.
7. **Ningún secreto en el repo, el navegador ni los logs.** Los secretos son variables de entorno
   del servidor, validadas en `lib/env.ts`. Una variable `NEXT_PUBLIC_` es pública.
8. **Sin rastros de ninguna marca privada** en esta plantilla: lo controla `npm run check`. Los
   ejemplos usan `example.com`.
9. **Código, comentarios y commits en inglés.** Los textos de la interfaz van en **los dos**
   diccionarios, `i18n/es.ts` e `i18n/en.ts`. La documentación es bilingüe (`X.md` y `X.es.md`).
10. **Preguntá antes de**: publicar, gastar plata, mandarle mensajes a gente real, cambiar datos
    de producción o correr una migración en una base real.

## 2. Dónde está cada cosa

| Ruta | Qué es |
|---|---|
| `config/` | `brand.ts` (la marca, en un solo lugar), `commerce.ts` (reglas comerciales), `fonts.ts`, `redirects.ts` |
| `content/products.json` | El catálogo en uso (adaptador de datos `json`). La demo es el preset `mixto` |
| `content/presets/` | Catálogos de arranque por rubro; `npm run preset <nombre>` aplica uno |
| `content/site.json` | Qué preset se aplicó y los textos de la portada (hero, beneficios, preguntas) |
| `content/downloads/` | Archivos de ejemplo de los productos digitales (privados: nunca en `public/`) |
| `i18n/` | `es.ts`, `en.ts` (diccionarios), `routes.ts` (URL pública de cada página por idioma) |
| `app/(store)/` | Páginas de la tienda. Las carpetas son las rutas en inglés; los otros idiomas se reescriben |
| `app/admin/` | El panel: `login`, `(panel)/` (kanban, resumen, productos, clientes, ajustes), impresión |
| `app/api/` | `orders` (crear), `payments/[provider]/webhook`, `events`, `admin/*` |
| `app/robots.ts`, `sitemap.ts`, `llms.txt`, `llms-full.txt`, `feeds/` | Buscadores, asistentes de IA y feeds de productos |
| `components/` | Por dominio: `layout`, `catalog`, `product`, `cart`, `checkout`, `admin`, `analytics` |
| `lib/data/` | Adaptadores de datos: `types.ts` (el contrato), `json.ts`, `sql.ts` + `supabase.ts` / `postgres.ts` |
| `lib/orders/` | `pricing.ts`, `idempotency.ts`, `receipt.ts` (enlace firmado del pedido), `status.ts` (el flujo) |
| `lib/payments/` | `manual`, `mercadopago`, `stripe`, `credit.ts` (acreditar un pago una sola vez) |
| `lib/admin/` | `auth.ts`, `session.ts`, `password.ts`, `login.ts`, `orders.ts`, `reports.ts`, `products.ts` |
| `lib/analytics/`, `lib/feeds/`, `lib/seo.ts`, `lib/indexnow.ts` | Medición, feeds, metadatos y datos estructurados |
| `db/schema.sql`, `db/seed.sql` | El esquema SQL compartido (Supabase y PostgreSQL) y los datos de demo |
| `proxy.ts` | Protege `/admin` y `/api/admin` |
| `stores/` | Estado del navegador (el carrito) |
| `scripts/` | `check-brand`, `check-i18n`, `admin-hash`, `preset`, `generate-images`, `generate-samples`, `generate-seed`, `screenshots` |
| `lib/booking/`, `lib/orders/download.ts`, `lib/admin/quotes.ts` | Turnos de un servicio, enlace de descarga firmado y presupuestos |
| `db/migrations/` | Un archivo por cambio de esquema, para bases que ya existen |
| `tests/fixtures/` | La tienda contra la que corren las pruebas (catálogo, textos, marca y reglas comerciales): nunca los archivos del dueño |
| `packages/create-cerebro-web/` | El creador de un comando (`npm create cerebro-web`), todavía sin publicar en npm |
| `tests/`, `e2e/` | Pruebas unitarias (Vitest) y de punta a punta (Playwright) |
| `cerebro/` | El cerebro: `datos.json` (fuente), `armar.mjs` (generador), `dist/` (generado y commiteado) |

## 3. Cómo trabajar

- **Mirá antes de construir.** Levantá el sitio y mirá la pantalla que vas a cambiar, en tamaño
  celular y en tamaño computadora.
- **Variables de diseño, no valores sueltos.** Los colores salen de los ocho valores de
  `config/brand.ts` (`app/globals.css` deriva el resto). CSS Modules por componente; un solo
  quiebre (768 px), primero el celular. Íconos: `lucide-react`. Sin framework de CSS ni librería
  de UI.
- **Táctil.** No armes gestos táctiles propios (arrastrar para cerrar, deslizar para mover):
  pelean con el scroll. Usá controles nativos. Un riel horizontal con scroll-snap necesita
  `scroll-padding` igual a su padding. Nunca pongas `overflow-x: hidden` en un ancestro de algo
  sticky: usá `clip`.
- **Una página nueva** necesita `generateMetadata` (con `pageMetadata` de `lib/seo.ts`), un solo
  `h1`, su ruta en `i18n/routes.ts` si es pública y una decisión sobre `robots` y el sitemap.
- **Una URL que cambia** necesita un 301 en `config/redirects.ts`.
- **Una variable de entorno nueva** se suma en `lib/env.ts` (validada) y en `.env.example`
  (explicada).
- **Un cambio de esquema** va en `db/schema.sql` **y** en un archivo nuevo de `db/migrations/`,
  tiene que poder correrse dos veces y se prueba en `tests/sql.test.ts` (incluida la actualización
  de una base creada con la versión anterior). Nunca lo corras en una base real sin la aprobación
  del dueño.

## 4. Verificar: no es opcional

```bash
npm run check       # sin marca privada, diccionarios parejos y TU catálogo válido
npm run typecheck
npm test
npm run build
npm run test:e2e    # el build de producción, en un navegador real, celu y compu
```

**Las pruebas tienen su propia tienda.** Las pruebas unitarias y las de punta a punta corren
contra `tests/fixtures/` —su catálogo, sus textos de portada, su marca y sus reglas comerciales— y
nunca contra `content/products.json`, `content/site.json`, `config/brand.ts` ni
`config/commerce.ts`. Por eso siguen en verde venda lo que venda el negocio: después de
`npm run preset <nombre>` y con un catálogo hecho a mano. Si una prueba falla, cambió el CÓDIGO,
no el catálogo.

**Después de cambiar el catálogo** (productos, categorías, textos de la portada), corré:

```bash
npm run check:catalog   # referencias rotas, borradores sin precio, textos de EJEMPLO que quedan
npm run build           # cada ficha de producto se genera
npm run doctor          # qué falta todavía para vender
```

y mirá la tienda. `tests/fixtures/` se toca sólo cuando cambia lo que hace el código, junto con
las pruebas que nombran sus productos.

Después mirala: `npm run screenshots` guarda cada pantalla clave y falla ante errores de consola.
Si tocaste el flujo de compra, comprá algo de punta a punta. Decí qué verificaste y qué **no**
pudiste verificar (un pago real, una base real, un correo real): nunca presentes una suposición
como un hecho.

## 5. Qué entregar

Un resumen corto: qué cambió, cómo lo verificaste (con números), qué queda pendiente y quién lo
tiene que hacer (vos o el dueño), y lo que necesita su aprobación.

## 6. Adaptarla a un rubro

Esto es una **base para modificar de punta a punta**, no un tema: el diseño, los textos, el flujo
de compra, el modelo de datos y el panel son tuyos para cambiar. La demo (un catálogo mixto) es
un ejemplo.

**Arrancá por el preset, no por la demo.**

1. `npm run preset` lista los catálogos de arranque; `npm run preset <nombre>` aplica el más
   parecido al negocio (productos, categorías, textos de la portada y una paleta sugerida). Leé
   el nodo de ese rubro en el cerebro, rama **«Adaptar a tu rubro»**.
2. Dale a cada producto su **tipo** —`physical`, `digital`, `service` (un turno, o un **evento**
   cuando tiene fechas fijas en `service.sessions`) o `quote`— y, si se vende
   por peso o medida, su `unit`, `step` y mínimo. [`docs/product-types.es.md`](docs/product-types.es.md)
   dice qué hace cada uno y qué garantiza el servidor.
3. Reemplazá **cada** EJEMPLO por lo que confirmó el dueño. Los precios, horarios, políticas y
   textos de un preset son de relleno: publicarlos es inventar datos del negocio (regla 1).
4. Preguntale al dueño lo que sólo él sabe de ese rubro: políticas de cancelación y devolución,
   plazos, qué pasa si el peso real difiere, licencias de los archivos digitales y qué
   habilitaciones o normas alcanzan a lo que vende. Nunca des por supuesta una regulación.

**Si el rubro necesita algo que no existe**, extendé la base sin romper su contrato:

1. Primero mirá: [`README.es.md`](README.es.md#para-qué-rubros-sirve) y [`ROADMAP.md`](ROADMAP.md)
   dicen qué está hecho y qué no. Si algo no está hecho, decíselo al dueño sin vueltas.
2. Probá con lo que hay: un tipo, una unidad, las opciones, los `attributes`, los textos y
   `config/commerce.ts` resuelven más casos de los que parece.
3. Un campo o un tipo nuevo recorre toda la cadena, en este orden: `lib/data/types.ts` → la regla
   pura en `lib/orders/` → `db/schema.sql` + una migración en `db/migrations/` → los tres
   adaptadores de datos (`json.ts`, y `sql.ts` para las dos bases) → las pantallas →
   `i18n/es.ts` y `en.ts` → la documentación y `CHANGELOG.md` con notas de migración.
4. Mantené las invariantes: todo importe lo pone el servidor; lo que no se puede sobrevender
   (stock, un turno) se controla donde se crea el pedido, de forma atómica; un archivo privado
   nunca tiene una dirección pública; nada se acredita sin un pago verificado por el total exacto.
5. Todo campo nuevo tiene un valor por defecto, para que los datos existentes sigan andando, y
   todo método nuevo del adaptador se implementa en los tres (TypeScript te dice cuál falta).
6. Probalo en tres niveles —la regla pura, el SQL sobre PGlite y de punta a punta en celu y en
   compu— antes de decir que funciona.

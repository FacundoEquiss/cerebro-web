[English](AGENTS.md) · **Español**

# Instrucciones para agentes

Estás trabajando en **Cerebro Web**, o en la web de un negocio hecha a partir de él: una tienda en
Next.js + un panel de gestión + una guía («el cerebro»). El dueño del negocio no programa. Te va a
pedir resultados («adaptá esto a mi negocio», «sumá envío gratis desde X»); vos hacés el trabajo
**y lo verificás**.

## 0. Primero, el cerebro

`cerebro/` tiene la guía para construir, lanzar y hacer crecer la web de un negocio (316 nodos).
Antes de tu primer cambio:

1. Leé `cerebro/dist/llms-full.txt` — como mínimo la rama **«Cómo usar este cerebro»** y los nodos
   **esenciales** de la fase en la que estás. (En línea: <https://cerebro-web-negocios.vercel.app/llms-full.txt>.)
2. Leé [`GETTING-STARTED.es.md`](GETTING-STARTED.es.md): el checklist ordenado para convertir esta
   plantilla en una web real, separando lo que hacés vos de lo que sólo puede hacer el dueño.
3. Volvé acá por las reglas de este código.

Si el cerebro y una costumbre tuya no coinciden, gana el cerebro. Si el cerebro y el **código** no
coinciden, revisá el código: es lo que corre.

## 1. Reglas que valen siempre

1. **Nunca inventes datos del negocio.** Precios, stock, direcciones, horarios, costos de envío,
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
| `content/products.json` | El catálogo de demostración (adaptador de datos `json`) |
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
| `scripts/` | `check-brand`, `check-i18n`, `admin-hash`, `generate-images`, `generate-seed`, `screenshots` |
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
- **Un cambio de esquema** va en `db/schema.sql`, tiene que poder correrse dos veces y se prueba
  en `tests/sql.test.ts`. Nunca lo corras en una base real sin la aprobación del dueño.

## 4. Verificar: no es opcional

```bash
npm run check       # sin marca privada, diccionarios parejos
npm run typecheck
npm test
npm run build
npm run test:e2e    # el build de producción, en un navegador real, celu y compu
```

Después mirala: `npm run screenshots` guarda cada pantalla clave y falla ante errores de consola.
Si tocaste el flujo de compra, comprá algo de punta a punta. Decí qué verificaste y qué **no**
pudiste verificar (un pago real, una base real, un correo real): nunca presentes una suposición
como un hecho.

## 5. Qué entregar

Un resumen corto: qué cambió, cómo lo verificaste (con números), qué queda pendiente y quién lo
tiene que hacer (vos o el dueño), y lo que necesita su aprobación.

[English](README.md) · **Español**

# Cerebro Web

**La web de un negocio, tuya, en un solo repositorio: una tienda que sirve para cualquier rubro,
un panel de gestión que recibe los pedidos en un tablero kanban y un «cerebro» que les explica a
los agentes de IA cómo construirla y hacerla crecer.**

> ### No es una plataforma: es una base que es tuya
>
> Tenés **todo el código** y cambiás **cualquier cosa**, de punta a punta: el diseño, los textos,
> el flujo de compra, el modelo de datos, el panel. Sin comisiones, sin abono mensual a una
> plataforma de tiendas y sin depender de la hoja de ruta de nadie. Y no hace falta hacerlo a
> mano: un agente de IA la adapta a tu negocio siguiendo el cerebro.
>
> La demo es **un ejemplo** de cómo puede quedar la base —un catálogo mixto con un producto de
> cada tipo—. Es un punto de partida para reescribir, no un tema para conservar.

Código abierto (MIT), genérica y sin atarse a ninguna plataforma. Hecha con Next.js; corre con
`next start` en cualquier servidor Node, en Docker o en Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/FacundoEquiss/cerebro-web)
&nbsp; o tocá **Use this template** arriba de todo en la página del repositorio.

| Tienda | Panel de gestión |
|---|---|
| ![Portada de la tienda de demostración](docs/screenshots/store-home.png) | ![Tablero kanban con pedidos en todos los estados](docs/screenshots/admin-kanban.png) |
| ![Página de un servicio: selector de día y hora](docs/screenshots/store-product.png) | ![Detalle de un pedido en el celular](docs/screenshots/admin-order-mobile.png) |

## Para qué rubros sirve

> **Los servicios, los presupuestos y los digitales necesitan una base de datos** (`supabase` o
> `postgres`): un turno, una consulta y una descarga cuelgan de un pedido guardado. El adaptador
> `json` de fábrica no guarda nada en producción: ahí esos productos muestran un botón
> «escribinos», y la demo avisa sin vueltas que nada queda reservado de verdad. Los productos
> físicos funcionan sin base de datos.

La base vende cuatro tipos de producto —**físico**, **digital**, **servicio con turno** y **a
presupuesto**—, por unidad o **por peso o medida**, y un carrito puede mezclarlos. Esto es lo que
le da a cada rubro, sin prometer lo que no está hecho (el detalle, en
[`docs/product-types.es.md`](docs/product-types.es.md)):

| Rubro | Viene listo | Lo adapta el agente, y cómo | En la hoja de ruta |
|---|---|---|---|
| **Moda e indumentaria** | Preset `moda`: talle y color que el cliente tiene que elegir, stock por variante, una foto por color, feeds con género, edad y material | Tabla de talles y política de cambios (textos); cuidados y calce en cada descripción | Reseñas con compra verificada; personalizador de productos |
| **Hogar y deco** | Preset `hogar`: variantes de color, piezas a pedido junto a las de stock, plazos en un solo lugar | Medidas, materiales y cuidados (textos); cómo viaja lo frágil o voluminoso (`config/commerce.ts`) | Envío por zona o por peso |
| **Tecnología y electrónica** | Preset `tecnologia`: stock real, precio de lista y de oferta, código de barras (GTIN) en los feeds, un servicio de instalación con turno | Garantía y ficha técnica (textos y atributos del producto) | Reseñas; alertas de stock |
| **Almacén, dietética y venta por peso** | Preset `almacen`: precio por kg, g, l…, cantidades decimales con mínimo y paso que valida el servidor, stock decimal y totales redondeados en el servidor | La política para cuando el peso real difiere del pedido (texto); ingredientes y alérgenos | Cobrar la diferencia del peso real; envío por peso |
| **Gastronomía y delivery** | Preset `gastronomia`: platos con tamaños, venta por kilo a pedido, catering a presupuesto, recepción de pedidos en vivo con sonido, retiro y envío con tarifa fija | Zona, horarios y alérgenos (textos); cerrar el checkout fuera de horario (código, chico) | Zonas de entrega por distancia; extras por plato; interruptor de abierto/cerrado |
| **Servicios con turno** (peluquería, consultorio, clases) | Preset `servicios`: selector de día y hora, duración, cupo por turno, horarios semanales, días bloqueados y zona horaria; **con una base de datos**, el turno se reserva al crear el pedido (pedidos simultáneos no pueden sobrevenderlo), uno impago se retiene por tiempo limitado, y el panel tiene una **Agenda** (día y semana) | Horarios propios de un servicio (archivo del catálogo); política de cancelación (texto); cobrar una seña en vez del total (código) | Recordatorios; que el cliente reprograme; una agenda por profesional o sala (hoy es una por servicio); sincronizar calendarios |
| **Productos digitales** (cursos, e-books, plantillas) | Preset `digital`: archivo privado, enlace de descarga firmado y con vencimiento, entregado en la página del pedido y por e-mail cuando el pedido está pagado (**necesita una base de datos**); sin envío | Licencia y política de reembolso (textos); varios archivos por producto (código, chico) | Reproductor de cursos / streaming; claves de licencia; límite de descargas |
| **Trabajos a medida, eventos y B2B** | Preset `a-medida`: sin precio público, formulario «Pedir presupuesto», consultas en su propia columna del kanban, precio por línea más envío, enlace firmado para aceptar y pagar (**necesita una base de datos**) | Preguntas extra en el formulario (código, chico); validez y seña (textos) | Presupuestos armados desde cero en el panel; presupuesto en PDF; fecha de vencimiento |
| **Suscripciones** | — | Vender el primer período como un producto y renovar a mano, avisándolo con claridad | Cobro recurrente |
| **Mayorista** | Cantidad mínima por producto, pedido mínimo, presupuesto para volúmenes | Un despliegue sólo mayorista con su propio catálogo | Precios escalonados por cantidad; listas por cliente; cuentas de cliente |
| **Marketplace de varios vendedores** | — | Un solo vendedor que publica productos de terceros y liquida por fuera | Multivendedor (en exploración: cambia el modelo de datos) |

**Empezá por tu rubro**: `npm run preset` lista los catálogos de arranque y
`npm run preset <nombre>` aplica uno (productos, categorías, textos de la portada y una paleta
sugerida; todo de ejemplo, para reemplazar). Si tu negocio necesita algo que todavía no existe,
[`AGENTS.es.md`](AGENTS.es.md) §6 explica cómo extender la base sin romper su contrato.

## Por qué existe

Un negocio chico que quiere vender por internet suele alquilar una tienda hospedada —Shopify,
Tiendanube, WooCommerce y similares— y vivir dentro de sus límites, comisiones y plantillas. Hoy
un agente de IA puede construir y mantener una web de verdad para ese negocio, **si** arranca de
algo que ya funciona y de instrucciones claras. Cerebro Web es ese punto de partida:

- **El dueño no programa.** Para cada web nueva le dice a un agente:

  > **«Adaptá esto a mi negocio siguiendo el cerebro.»**

- **El agente** lee [`AGENTS.es.md`](AGENTS.es.md), después el cerebro (`cerebro/`) y sigue
  [`GETTING-STARTED.es.md`](GETTING-STARTED.es.md): marca, productos, fotos, base de datos, pagos,
  legales, dominio y buscadores.
- **Todo queda en tus manos**: el código, los datos y los clientes. Sin abono mensual a una
  plataforma de tiendas.

## Qué trae

**1. La tienda** — portada, tienda con filtros y orden, categorías, página de producto (galería,
elección obligatoria de talle y color, stock, datos estructurados), carrito, checkout, página del
pedido con comprobante firmado, búsqueda, contacto y plantillas de legales. Pensada primero para
el celular, accesible, rápida y renderizada en el servidor (todo el contenido está en el HTML sin
JavaScript).

**2. El panel de gestión (`/admin`)** — lo que reemplaza a la plataforma hospedada:

- **Kanban de pedidos**: Nuevo · Pagado · En preparación · Listo / Enviado · Entregado (Cancelado,
  plegado aparte). Las tarjetas se arrastran con el ratón, se mueven con el menú «Mover a…» en el
  celular o con el teclado. Cada movimiento queda en el historial del pedido.
- **Recepción en vivo**: los pedidos nuevos aparecen solos, con un contador en la pestaña, un
  sonido opcional, la notificación del navegador y un correo al dueño.
- **Detalle del pedido**: ítems, cliente, entrega, pago, línea de tiempo, notas internas,
  confirmar un pago a mano, cancelar con motivo, imprimir remito o etiqueta y escribirle al
  cliente por WhatsApp con un mensaje armado según el estado.
- **Resumen de ventas**, **productos** (crear, editar, fotos achicadas a WebP en el navegador,
  stock editable en la lista), **clientes** (armados a partir de los pedidos) y **ajustes** de
  sólo lectura.
- Ingreso sin proveedor externo: contraseñas con hash scrypt en una variable de entorno y cookie
  de sesión firmada.

**3. El cerebro (`cerebro/`)** — un mapa mental con 331 nodos accionables sobre cómo construir,
lanzar y hacer crecer la web de un negocio: estrategia, tienda, checkout, SEO, buscadores con IA,
medición, publicidad, seguridad, calidad y trabajo con agentes. Se publica aparte en
<https://cerebro-web-negocios.vercel.app> y este proyecto lo cumple.

**Todo se puede cambiar** detrás de interfaces chicas ([`docs/adapters.es.md`](docs/adapters.es.md)):

| Adaptador | Opciones | Por defecto |
|---|---|---|
| Datos (catálogo + pedidos) | `json` · `supabase` · `postgres` | `json` |
| Pagos | `manual` (transferencia / WhatsApp) · `mercadopago` · `stripe` | `manual` |
| Correo | `console` · `resend` · `smtp` | `console` |
| Fotos | `local` · `supabase` | `local` |
| Antibots | `none` · `turnstile` | `none` |

La tienda y el panel leen y escriben **sólo a través de los adaptadores**, así un CRM externo
puede reemplazar al panel.

## Correrla en tu máquina

Necesita Node 22.

```bash
git clone https://github.com/FacundoEquiss/cerebro-web mi-tienda
cd mi-tienda
npm install
npm run dev
```

Abrí <http://localhost:3000> para la tienda y <http://localhost:3000/admin> para el panel. Sin
configurar nada corre en **modo demo**: catálogo de demostración, pedidos de ejemplo en todos los
estados y un usuario demo de sólo lectura con sus credenciales a la vista en la pantalla de
ingreso.

Para usar el panel de verdad en tu máquina, creá tu usuario:

```bash
npm run admin:hash          # pide e-mail y contraseña y muestra la línea para ADMIN_USERS
cp .env.example .env.local  # pegá ahí ADMIN_USERS y ADMIN_SESSION_SECRET
```

En modo `json` local, los pedidos, el stock y los productos editados se guardan en `.data/` (que
nunca se commitea).

### Con Docker

```bash
docker build -t mi-tienda --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com --build-arg ALLOW_INDEXING=1 .
docker run -p 3000:3000 --env-file .env -v datos-tienda:/data mi-tienda
```

Otras formas de hospedarla (un VPS con un gestor de procesos, Vercel):
[`docs/deploy.es.md`](docs/deploy.es.md).

## De la demo a cobrar de verdad

El checklist completo y ordenado —qué hace el agente y qué sólo puede hacer el dueño— está en
[`GETTING-STARTED.es.md`](GETTING-STARTED.es.md). La versión corta:

1. **Marca y reglas**: `config/brand.ts` (nombre, colores, contacto, país, moneda, idioma) y
   `config/commerce.ts` (envíos, mínimos, plazos, datos bancarios).
2. **Productos**: reemplazar el catálogo de demostración (`content/products.json`) y sus imágenes.
3. **Datos**: crear una base, correr `db/schema.sql` y poner `DATA_SOURCE=supabase` o `postgres`.
   Los pedidos se guardan, el stock baja y el panel guarda los cambios.
4. **Secretos**: `ORDER_SECRET`, `ADMIN_USERS`, `ADMIN_SESSION_SECRET` y `DEMO_MODE=false`. En
   producción el servidor se niega a arrancar sin `ORDER_SECRET` (cargalo en las variables de
   entorno del hosting; en Vercel, antes del primer despliegue).
5. **Pagos**: seguir con `manual`, o `PAYMENT_PROVIDER=mercadopago` / `stripe` con el secreto de su
   webhook — y hacer un pago real de punta a punta antes de anunciar nada.
6. **Salir**: `APP_ENV=production`, tu dominio en `NEXT_PUBLIC_SITE_URL`, los textos legales
   reales y recién entonces `ALLOW_INDEXING=1`.

La pantalla **Ajustes** del panel lista lo que todavía falta.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run check` | Sin rastros de una marca privada en el repo; diccionarios parejos |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Pruebas unitarias (Vitest), con el SQL real sobre un PostgreSQL en proceso |
| `npm run test:e2e` | Pruebas de punta a punta (Playwright) contra el build de producción, en celu y compu |
| `npm run admin:hash` | Crea la línea de un usuario para `ADMIN_USERS` |
| `npm run brain` | Regenera el sitio estático del cerebro en `cerebro/dist/` |
| `npm run preset` / `npm run preset <nombre>` | Lista los catálogos de arranque / aplica uno (productos, textos de la portada, paleta) |
| `npm run images` / `npm run samples` / `npm run db:seed` | Redibuja las imágenes / las descargas de ejemplo / regenera `db/seed.sql` |
| `npm run data:export` | Copia los productos editados en local (modo json) a `content/products.json` |
| `npm run screenshots` | Captura cada pantalla clave y falla ante errores de consola |

## Documentación

- [`AGENTS.es.md`](AGENTS.es.md) — instrucciones para agentes de IA (y personas).
- [`GETTING-STARTED.es.md`](GETTING-STARTED.es.md) — de la plantilla a la web de un negocio.
- [`docs/product-types.es.md`](docs/product-types.es.md) — físicos, digitales, servicios, presupuestos, venta por peso y presets.
- [`docs/adapters.es.md`](docs/adapters.es.md) — los contratos de los adaptadores y cómo sumar uno.
- [`docs/admin.es.md`](docs/admin.es.md) — el panel: acceso, kanban y recepción en vivo.
- [`docs/deploy.es.md`](docs/deploy.es.md) — hospedaje en cualquier servidor Node, Docker o Vercel.
- [`ROADMAP.md`](ROADMAP.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md)
- [`llms.txt`](llms.txt) — el mapa de este repositorio para un agente de IA.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estricto · Zod · Zustand (carrito) · variables CSS
+ CSS Modules (sin framework de CSS ni librería de UI) · íconos `lucide-react` (ISC) · tipografías
Fraunces e Inter (SIL Open Font License, servidas desde el propio sitio). Sin logos ni marcas de
terceros en la interfaz ni en las imágenes; las imágenes de demo las dibuja un script de este
repositorio.

## Licencia

[MIT](LICENSE) — Copyright (c) 2026 Cerebro Web contributors.

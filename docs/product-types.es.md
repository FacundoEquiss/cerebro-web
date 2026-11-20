[English](product-types.md) · **Español**

# Tipos de producto

Cerebro Web es una base para **cualquier rubro**. Lo que lo hace posible es un campo del producto,
`type`, más una forma de vender por peso o medida. Esta página dice qué hace cada tipo, qué se
configura y qué garantiza el servidor.

| `type` | Qué es | Qué pide la ficha | Envío | Después del pago |
|---|---|---|---|---|
| `physical` | Algo que se envía o se retira (el valor por defecto) | Opciones y cantidad | Sí | Se prepara el pedido |
| `digital` | Un archivo | Nada (uno por línea) | No | Un enlace de descarga firmado, con vencimiento |
| `service` | Un turno | Día y hora (y lugares) | No | El turno ya está reservado |
| `quote` | Algo sin precio público | Cantidad y una descripción | Lo define el dueño | — se paga después de aceptar el presupuesto |

Tres reglas valen para todos, y son las mismas en `lib/orders/pricing.ts` (adaptador `json`) y en
`create_order()` (`db/schema.sql`, adaptadores de base de datos):

1. **El precio lo pone el servidor.** El navegador manda ids, cantidades y, en un servicio, el
   turno. Nunca un importe.
2. **Envío sólo si hay algo para enviar.** Un pedido sin productos físicos tiene método `none`, no
   pide dirección y no cobra envío, mande lo que mande el navegador.
3. **Un carrito puede mezclar tipos.** Una descarga, un turno y una taza son un solo pedido.

## Dónde se define el tipo

- En el panel: **Productos → un producto → Tipo y forma de venta**.
- En el archivo del catálogo (`content/products.json`, adaptador `json`) o en la tabla `products`:

```jsonc
{
  "id": "mix-de-frutos-secos", "type": "physical",
  "price": 19500,          // por unidad de medida
  "unit": "kg",            // "u" (por unidad, el valor por defecto), "kg", "g", "l", "m", "m²"…
  "step": 0.1,             // las cantidades son múltiplos de esto
  "minQuantity": 0.1,      // el mínimo de una línea (el «min»)
  "maxQuantity": 3,        // opcional; null = commerce.maxQuantityPerLine
  "stock": 25              // en la misma unidad; null = a pedido
}
```

## Venta por unidad, peso o medida

Sirve para cualquier producto físico (y para presupuestos: «por m²»).

- `unit` es a qué se refiere el precio. Con cualquier cosa distinta de `u` la tienda muestra
  **«$ 19.500 / kg»** y la cantidad con su unidad («0,7 kg»).
- `step` y `minQuantity` definen las cantidades válidas: con `step: 0.25` y `minQuantity: 0.25`
  se puede comprar 0,25; 0,5; 0,75… El **servidor** rechaza cualquier otra (error `quantity`): los
  botones de la ficha son sólo una ayuda.
- **Totales**: cada línea se redondea a centavos por separado (`precio × cantidad`) y el subtotal
  suma las líneas ya redondeadas. Es lo que el cliente ve línea por línea, y TypeScript y SQL lo
  hacen igual.
- El **stock** va en la misma unidad y puede ser decimal (12,5 kg).
- Las pasarelas de pago cuentan unidades enteras: una línea de 0,75 kg viaja como un ítem que
  vale la línea («Café — 0,75 kg»).
- **Lo que no está hecho**: cobrar la diferencia cuando el peso real no coincide con el pedido.
  Escribí tu política (la ficha tiene un renglón para eso, `types.weightNote` en `i18n/`) y
  resolvé la diferencia a mano.

## Productos digitales

- El producto tiene `digital: { "name": "guia.pdf", "file": "<clave de almacenamiento>" }`. El
  archivo se sube desde el panel (**Archivo que se entrega**) y va al lado **privado** del
  adaptador de almacenamiento.
- **El archivo nunca es público.** No está en `public/`; la tienda nunca recibe la clave de
  almacenamiento (en SQL vive en `product_files`, una tabla que la clave pública no puede leer).
- **Entrega**: cuando el pedido está pagado —por el webhook de una pasarela, o cuando el admin
  marca pagado un pedido `manual`— la página del pedido muestra el botón **Descargar** y el
  e-mail de «pago confirmado» lleva el enlace.
- **El enlace** es `/api/downloads/<pedido>/<línea>?e=<vencimiento>&s=<firma>`: lo firma el
  servidor (`lib/orders/download.ts`) y dura `commerce.digital.linkHours` (72 por defecto). La
  ruta verifica, en este orden: la firma y el vencimiento → que el pedido guardado **esté pagado
  en este momento** y no cancelado → que esa línea sea un producto digital con archivo. La página
  del pedido genera un enlace nuevo cada vez que se abre, mientras el enlace del pedido sea válido
  (30 días).
- Almacenamiento: `local` guarda los archivos en `DATA_DIR/private`; `supabase` usa un bucket
  **privado** (`SUPABASE_PRIVATE_BUCKET`, `downloads` por defecto: crealo como privado). Las
  subidas tienen un tope de 50 MB y aceptan tipos comunes de documento, comprimido, audio, video e
  imagen (`DIGITAL_TYPES`); en hospedajes serverless el tope de la plataforma es menor.
- Necesita un adaptador que **guarde pedidos** (una base de datos, o `json` en una máquina con
  disco): sin eso nadie puede saber si un pedido se pagó, así que no se entrega nada.
- Los archivos de ejemplo de los presets son PDF mínimos en `content/downloads/`
  (`npm run samples`).

## Servicios con turno

Un servicio tiene `service: { "durationMinutes": 30, "capacity": 1 }`.

- Los **horarios** salen de `config/commerce.ts` → `booking`: `timeZone` (IANA), `weekly` (rangos
  por día de la semana), `blockedDates` (días cerrados), `minNoticeHours` y `maxDaysAhead`. Un
  producto puede pisarlos: `service.weekly` reemplaza la semana y `service.blockedDates` suma días
  cerrados.
- Los **turnos** arrancan cada `durationMinutes` dentro de cada rango y nunca pasan del cierre.
  `capacity` es cuántos lugares entran en un turno (1 para un corte, 8 para una clase); la
  cantidad de la línea es la cantidad de lugares.
- **Zona horaria**: los horarios se escriben como hora de `booking.timeZone`; el turno se guarda
  como el instante exacto en que empieza y termina. Un visitante en otro huso, un servidor en otra
  zona o un cambio de horario de verano no pueden mover un turno.
- **Reserva**: el turno se reserva al **crear** el pedido. El servidor primero comprueba que sea
  un turno que el servicio ofrece de verdad en ese momento (`lib/booking/slots.ts`) y después
  `create_order()` revisa el cupo con la fila del producto bloqueada —dos pedidos simultáneos no
  pueden llevarse el último lugar—; la misma clave de idempotencia devuelve siempre el mismo
  pedido.
- **Liberación**: una reserva es la línea de servicio de un pedido que no está cancelado. Cancelar
  el pedido, o dejarlo vencer sin pagar (`ORDER_EXPIRY_HOURS`), libera el lugar solo. Ojo: un
  pedido sin pagar retiene su turno hasta que vence; bajá `ORDER_EXPIRY_HOURS` si es mucho para tu
  negocio.
- **Agenda**: `/admin/agenda`, por día o por semana (ver [`admin.es.md`](admin.es.md)). El turno
  también se ve en la tarjeta del kanban y en el detalle del pedido.
- **Lo que no está hecho**: recordatorios, que el cliente reprograme, una agenda por profesional,
  sincronizar calendarios, señas. Ver [`ROADMAP.md`](../ROADMAP.md).

## Presupuestos

Un producto `quote` no tiene precio público: la tienda muestra **«Consultar»** y un formulario.

1. El cliente manda una cantidad y un detalle (`POST /api/quotes`). Queda como un pedido en estado
   `quote` —una **consulta**— en la primera columna del kanban. Sin importes en ningún lado.
2. El dueño la abre, carga un **precio unitario por línea** y el **envío**, y la **envía**. Al
   cliente le llega un e-mail con un enlace firmado.
3. El cliente ve el presupuesto en la página del pedido y lo **acepta**, eligiendo cómo pagar.
   Desde ahí es un pedido normal (`new`): transferencia, mensaje o pasarela.

Lo que garantiza el servidor (`accept_quote()` en SQL, `acceptQuote` en los adaptadores):

- Un presupuesto que **no fue enviado** no se puede aceptar ni pagar.
- Se acepta sólo por el **total exacto que se envió**: el formulario manda el total que vio el
  cliente y, si el guardado es otro —cambió el precio o alguien tocó el formulario—, no pasa nada.
  Guardar un precio nuevo *des-envía* el presupuesto: hay que volver a enviarlo.
- Un producto sin precio nunca entra a un carrito ni a un pedido (`quote_only`).
- Una consulta no vence como «impaga»; un presupuesto aceptado cuenta su `ORDER_EXPIRY_HOURS`
  desde que se aceptó.

## Feeds y datos estructurados

Los **feeds de productos** (`/feeds/google.xml`, `/feeds/meta.xml`) listan **sólo productos
físicos con precio** (`feedable()` en `lib/feeds/index.ts`). Por qué, según lo verificado el
2026-11-20:

- **Google Merchant Center** — su política de «contenido de Shopping no admitido»
  (<https://support.google.com/merchants/answer/6150006>) dice que los servicios no se admiten
  (trabajo, tiempo o acciones que no resultan en la propiedad de un producto tangible) y que los
  libros digitales no se admiten en los anuncios de Shopping. Otros bienes digitales pueden
  aceptarse; quedan afuera por defecto para ir a lo seguro. Además, una fila necesita un precio
  real, y un producto a presupuesto no lo tiene.
- **Catálogo de Meta** — la página de las Políticas de comercio de Meta **no** se pudo abrir desde
  el entorno donde se escribió esto, así que **no está verificado** contra el texto oficial.
  Fuentes secundarias coinciden en que el contenido digital descargable, las suscripciones y los
  servicios no se aceptan como ítems de catálogo. Tomalo como «probablemente excluido» y leé la
  política vigente antes de cambiarlo.

Las políticas cambian. Para listar otro tipo, primero leé la política vigente de esa plataforma y
después editá `feedable()`: una sola función, con su prueba en `tests/product-types.test.ts`.

Los productos por peso llevan `unit_pricing_measure` («1 kg») en los feeds.

**Datos estructurados** (`productJsonLd` en `lib/seo.ts`):

| Tipo | JSON-LD |
|---|---|
| `physical` | `Product` + `Offer` (una por variante). Por peso: la oferta suma un `UnitPriceSpecification` |
| `digital` | `Product` + `Offer`, siempre disponible, sin condición del artículo |
| `service` | `Service` con su `provider` y una `Offer` con el precio de un turno |
| `quote` | `Product` **sin `offers`**: no hay precio público, así que no se declara ninguno; nunca un importe inventado |

## Presets: un catálogo de arranque por rubro

```bash
npm run preset              # los lista
npm run preset servicios    # aplica uno
npm run preset moda -- --keep-theme   # …sin tocar los colores
```

| Preset | Para | Qué tipos muestra |
|---|---|---|
| `mixto` | La demo: uno de cada cosa | los cuatro, y venta por peso |
| `moda` | Moda e indumentaria | físicos con talle y color |
| `hogar` | Hogar y deco | físicos, variantes, a pedido |
| `tecnologia` | Tecnología y electrónica | físicos con stock, un servicio de instalación |
| `almacen` | Almacén y dietética | por kilo y por gramo, envasados |
| `gastronomia` | Gastronomía y delivery | platos con tamaños, por kilo, catering a presupuesto |
| `servicios` | Servicios con turno | servicios (individual y grupal), un producto, un presupuesto |
| `digital` | Productos digitales | descargas, mentoría con turno, un presupuesto |
| `a-medida` | Trabajos a medida, eventos y B2B | presupuestos, una visita con turno, un muestrario |

Un preset es un JSON en `content/presets/` con productos, categorías, los textos de la portada
(hero, beneficios, preguntas) y una paleta sugerida. Aplicarlo escribe `content/products.json`,
`content/site.json`, los ocho colores de `theme` en `config/brand.ts` y `db/seed.sql`.
**Todo lo que trae un preset es de ejemplo** —nombres, precios, textos— y sus imágenes son
placeholders dibujados por `npm run images`. Reemplazá todo por los datos reales del negocio.

Para sumar un preset: copiá uno, cambialo, corré `npm run images` (las formas nuevas van en
`scripts/generate-images.mjs`) y `npm test` (cada preset se valida).

## Actualizar desde 0.1.0

Las notas de migración están en [`CHANGELOG.md`](../CHANGELOG.md#020---2026-11-20).

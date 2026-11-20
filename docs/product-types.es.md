[English](product-types.md) · **Español**

# Tipos de producto

Cerebro Web es una base para **cualquier rubro**. Lo que lo hace posible es un campo del producto,
`type`, más una forma de vender por peso o medida. Esta página dice qué hace cada tipo, qué se
configura y qué garantiza el servidor.

| `type` | Qué es | Qué pide la ficha | Envío | Después del pago |
|---|---|---|---|---|
| `physical` | Algo que se envía o se retira (el valor por defecto) | Opciones y cantidad | Sí | Se prepara el pedido |
| `digital` | Un archivo | Nada (uno por línea) | No | Un enlace de descarga firmado, con vencimiento |
| `service` | Un turno, o un **evento** con fechas fijas | Día y hora, o una de las fechas (y lugares) | No | El turno ya está reservado |
| `quote` | Algo sin precio público | Cantidad y una descripción | Lo define el dueño | — se paga después de aceptar el presupuesto |

Tres reglas valen para todos, y son las mismas en `lib/orders/pricing.ts` (adaptador `json`) y en
`create_order()` (`db/schema.sql`, adaptadores de base de datos):

1. **El precio lo pone el servidor.** El navegador manda ids, cantidades y, en un servicio, el
   turno. Nunca un importe.
2. **Envío sólo si hay algo para enviar.** Un pedido sin productos físicos tiene método `none`, no
   pide dirección y no cobra envío, mande lo que mande el navegador.
3. **Un carrito puede mezclar tipos.** Una descarga, un turno y una taza son un solo pedido.

## Estos tres necesitan una tienda que guarde los pedidos

Un turno lo reserva un pedido **guardado**, un presupuesto se cotiza sobre una consulta
**guardada** y un archivo se entrega cuando un pedido **guardado** está pagado. Por eso los
productos `service`, `quote` y `digital` necesitan un adaptador de datos que guarde pedidos:
`supabase`, `postgres`, o `json` en una máquina tuya con un `DATA_DIR` escribible. **`json` en
producción no guarda nada** (`APP_ENV=production`, o cualquier despliegue en Vercel): es el
adaptador de la demo.

Qué pasa sin uno (`lib/store-mode.ts`):

| | La tienda | El servidor |
|---|---|---|
| **Una tienda real** (sin modo demo) | La ficha no muestra calendario, formulario de presupuesto ni «agregar al carrito» para esos productos: lo dice y ofrece WhatsApp y la página de contacto | `POST /api/orders` y `POST /api/quotes` responden `409 needs_store` |
| **Modo demo** (`DEMO_MODE`, la demo publicada) | Los flujos se pueden probar, y la ficha y la página del pedido avisan que no se guarda nada: el turno **no** queda tomado de verdad, la consulta no le llega a nadie y la descarga no se entrega. Ningún horario figura como ocupado | Los pedidos se calculan y se responden, pero no se guardan |

Los productos físicos no cambian: siempre se pueden vender con el comprobante firmado como única
copia del pedido.

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
- Necesita un adaptador que **guarde pedidos**: una base de datos, o `json` **fuera de
  producción** con un `DATA_DIR` escribible. `json` con `APP_ENV=production` (o en Vercel) no
  guarda nada, tenga el disco que tenga: nadie puede saber si un pedido se pagó, así que no se
  entrega nada. Ver la sección de arriba.
- Una descarga es **una por línea** (el servidor rechaza una cantidad distinta de 1).
- El archivo se **transmite por partes**, nunca se carga entero en memoria. En hospedajes
  serverless la plataforma igual limita el tamaño y la duración de una respuesta (pocos MB y
  segundos en los planes más chicos): para archivos grandes usá un servidor propio o subí esos
  límites.
- Con `STORAGE_PROVIDER=supabase` el servidor **comprueba que el bucket sea privado** antes de la
  primera lectura o escritura privada (y de nuevo cada 10 minutos). Un bucket público —o uno
  cuya configuración no se puede leer— se rechaza: no se sirve nada y el log dice por qué.
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
- **Horario de verano**: una hora que los relojes saltean ese día (las 02:30 cuando pasan de
  02:00 a 03:00, o las 00:30 en una zona que cambia a medianoche) no se ofrece; una hora que
  ocurre dos veces es siempre la primera de las dos.
- **Reserva** (con un adaptador que guarde pedidos; ver arriba): el turno se reserva al **crear**
  el pedido. El servidor primero comprueba que sea un turno que el servicio ofrece de verdad en
  ese momento (`lib/booking/slots.ts`) y después `create_order()` revisa el cupo con la fila del
  producto bloqueada —dos pedidos simultáneos no pueden llevarse el último lugar—; la misma clave
  de idempotencia devuelve siempre el mismo pedido.
- **El cupo cuenta lo que se superpone**, no lo que arranca en el mismo minuto: si cambiás la
  duración de un servicio, los turnos ya tomados siguen bloqueando el tiempo que ocupan. Es **una
  agenda por producto**: dos servicios no se bloquean entre sí, y no hay agenda por profesional
  ni por sala (está en la hoja de ruta).
- **Retenciones**: un pedido sin pagar conserva su turno durante `booking.holdHours` (12 por
  defecto; la variable `BOOKING_HOLD_HOURS` lo pisa), menos que `ORDER_EXPIRY_HOURS` a propósito.
  Cuando la retención vence, el lugar queda libre **en el acto**: cada lectura (el calendario, la
  Agenda, un pedido nuevo) deja de contarlo, sin que tenga que correr nada. El pedido en sí lo
  cancela la limpieza de siempre (al pasar, y por la ruta del cron). Un turno pagado no vence.
- **Topes**: un pedido puede traer `booking.maxSlotsPerOrder` turnos (3) y un comprador —por
  e-mail— puede retener `booking.maxUnpaidPerBuyer` turnos impagos a la vez (3). Los lugares son
  enteros.
- **Liberación**: una reserva es la línea de servicio de un pedido que no está cancelado. Cancelar
  el pedido libera el lugar solo.
- **Agenda**: `/admin/agenda`, por día o por semana (ver [`admin.es.md`](admin.es.md)). El turno
  también se ve en la tarjeta del kanban y en el detalle del pedido.
- **Lo que no está hecho**: recordatorios, que el cliente reprograme, una agenda por profesional,
  sincronizar calendarios, señas. Ver [`ROADMAP.md`](../ROADMAP.md).

## Eventos: fechas propias y lugares limitados

Un taller, una clase suelta, una charla, una entrada: no pasa «todos los lunes de 9 a 18», pasa en
**sus propias fechas**. Es un servicio con una regla que se repite, una lista de fechas, o las dos:

```jsonc
{
  "id": "taller-de-cocina", "type": "service", "price": 32000,
  "service": {
    "durationMinutes": 180,
    "capacity": 12,                                   // lugares de CADA fecha
    // «El primer sábado de cada mes a las 10:00», con las próximas 3 fechas abiertas:
    "repeat": { "week": 1, "weekday": "sat", "time": "10:00", "count": 3 },
    // …y/o fechas sueltas. Una fecha puede tener su propia duración:
    "sessions": [{ "start": "2027-03-20T18:00", "durationMinutes": 240 }],
    "blockedDates": ["2027-01-02"]                    // una fecha de la regla que no se hace
  }
}
```

- **`repeat`** — `week` es `1`, `2`, `3`, `4`, `"last"` (el último de cada mes) o `"every"` (todas
  las semanas); `weekday` es `mon`…`sun`; `time` es hora de `booking.timeZone`; `count` es cuántas
  fechas próximas quedan abiertas a la vez (3 si no se indica, 24 como máximo). Las fechas se
  calculan desde hoy: el evento **nunca se queda sin fechas** y nadie tiene que volver a cargarlas.
- **`sessions`** — fechas explícitas, para lo que no sigue una regla. Se suman; una fecha escrita
  dos veces es una sola.
- En el panel: **Tipo → Servicio**, y en **Cómo se reserva → Evento o taller**. Ahí se elige la
  repetición y se escriben las fechas sueltas, una por línea (`2027-03-20 18:00`, más los minutos
  al final si esa fecha dura distinto: `2027-03-20 18:00 240`).
- **Un evento sigue siendo evento aunque no le queden fechas**: la tienda dice «Por ahora no hay
  fechas abiertas» en vez de caer en la agenda semanal. `npm run check:catalog` lo avisa.
- La agenda semanal, la anticipación y la ventana del calendario no se aplican a un evento.
- La tienda muestra una **lista de fechas** con «Quedan N lugares» y el botón **Inscribirme**; la
  cantidad es la cantidad de lugares. Una fecha que ya pasó deja de ofrecerse sola.
- Todo lo demás es el motor de reservas de la sección anterior: los lugares se reservan al crear
  el pedido (sin sobreventa), las retenciones vencen, los topes por pedido y por comprador, la
  Agenda (con **Próximo evento** e **Ir a una fecha**), y la necesidad de un adaptador que guarde
  pedidos.
- **Mover o quitar una fecha que tiene inscripciones**: las reservas siguen en sus pedidos y en la
  Agenda. El panel avisa al guardar, con la fecha y los lugares; a esas personas les avisa el dueño.
- **Dos fechas del mismo evento que se pisan comparten el cupo** (el motor cuenta lugares por
  producto y horario). `npm run check:catalog` lo avisa. Dos actividades a la misma hora son dos
  productos.
- Datos estructurados: un `Event` por cada fecha próxima (inicio, fin y precio), con `SoldOut`
  cuando la fecha está completa. `location` sólo se declara si `brand.contact.address` está
  cargado: nunca se inventa.
- `npm run check:catalog` también avisa de una fecha escrita dos veces y de una fecha a una hora
  que los relojes saltean ese día (cambio de hora): nadie podría inscribirse.
- **Lo que no está hecho**: lista de espera, entradas con código para controlar en la puerta, y
  precio o cupo distinto por fecha. Ver [`ROADMAP.md`](../ROADMAP.md).

## Borradores: un producto sin precio

Cuando el dueño todavía no dio el precio, **no lo inventes**. Cargá el producto como borrador:
`"price": null` en el archivo del catálogo, o la casilla **Borrador** en el panel.

- Un borrador **no se vende**: no aparece en la tienda, el buscador, el sitemap, los feeds,
  `llms.txt` ni los datos estructurados, y el servidor rechaza cualquier pedido que lo incluya.
- El panel lo lista con **Falta el precio**. `npm run check:catalog` y `npm run doctor` listan
  todos los borradores: esa es la lista de preguntas para el dueño.
- Cuando llega el precio, cargalo y destildá la casilla. El campo del precio de un borrador
  arranca vacío, y **el precio 0 se rechaza en todo lo que está a la venta** (en el formulario y en
  el servidor): 0 es un campo vacío, no un producto gratis.
- **Un presupuesto es la excepción.** `type: "quote"` no tiene precio público por naturaleza, así
  que ahí `"price": null` (o `0`) es lo normal: el producto se muestra, con su formulario de
  consulta. Para ocultar un presupuesto que no está listo, marcalo con `"draft": true`.

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
- **Un presupuesto que cobra envío pide la dirección de entrega** cuando el cliente lo acepta, y
  sin ella no se acepta.
- **Cómo llega el presupuesto**: al enviarlo se le manda un e-mail al cliente **si hay un
  proveedor de correo configurado**; el panel dice si el e-mail salió de verdad. En cualquier
  caso el editor muestra el enlace firmado del cliente, con un botón para copiarlo y otro para
  mandarlo por WhatsApp.
- El texto libre de una consulta nunca viaja en el enlace del pedido: la página lo lee de la base.

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
npm run preset moda -- --force        # …sobre un catálogo que ya es tuyo
```

**Reemplaza archivos, así que cuida tu trabajo.** Se niega a correr —salvo con `--force`— cuando
`content/products.json`, `content/site.json` o los colores de `config/brand.ts` ya no son los de
un preset, o cuando esos archivos (o `db/seed.sql`) tienen cambios sin commitear. Antes de
escribir siempre copia lo que había en `.preset-backups/<fecha-hora>/` (una carpeta por corrida,
nunca se pisa, git la ignora) y aparta el `catalog.json` y el `orders.json` locales de
`DATA_DIR`, que apuntarían a productos que ya no existen.

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

**Las pruebas no dependen del catálogo.** Corren contra `tests/fixtures/`, así que `npm test` y
`npm run test:e2e` siguen en verde después de cualquier preset y con cualquier catálogo propio.
Lo que revisa TU catálogo es `npm run check:catalog` (parte de `npm run check`).

Para sumar un preset: copiá uno, cambialo, corré `npm run images` (las formas nuevas van en
`scripts/generate-images.mjs`) y `npm test` (cada preset se valida).

## Actualizar desde 0.1.0

Las notas de migración están en [`CHANGELOG.md`](../CHANGELOG.md#020---2026-11-20).

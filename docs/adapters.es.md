[English](adapters.md) · **Español**

# Adaptadores

Todo lo que toca el mundo de afuera está detrás de una interfaz chica. La tienda y el panel de
gestión **leen y escriben sólo a través de estos adaptadores**: ninguna página ni ruta importa un
cliente de base de datos ni el SDK de un procesador de pagos. Eso permite cambiar de proveedor con
una variable de entorno y que un **CRM externo reemplace al panel**: se implementa el adaptador de
datos contra el CRM y la tienda y el panel siguen andando.

| Adaptador | Se elige con | Interfaz | Implementaciones |
|---|---|---|---|
| Datos | `DATA_SOURCE` | `DataAdapter` en `lib/data/types.ts` | `json`, `supabase`, `postgres` |
| Pagos | `PAYMENT_PROVIDER` | `PaymentAdapter` en `lib/payments/types.ts` | `manual`, `mercadopago`, `stripe` |
| Correo | `MAIL_PROVIDER` | `MailAdapter` en `lib/mail/index.ts` | `console`, `resend`, `smtp` |
| Fotos | `STORAGE_PROVIDER` | `StorageAdapter` en `lib/storage/index.ts` | `local`, `supabase` |
| Antibots | `ANTIBOT_PROVIDER` | `AntibotAdapter` en `lib/antibot/index.ts` | `none`, `turnstile` |

## Datos

```ts
interface DataAdapter {
  readonly id: string;
  readonly storesOrders: boolean;   // false → el comprobante firmado es la única copia del pedido
  readonly writable: boolean;       // false → el panel es de sólo lectura

  // tienda
  listProducts(): Promise<Product[]>;            // sólo los activos
  listCategories(): Promise<Category[]>;
  createOrder(request, shipping): Promise<Order>; // los precios se calculan ACÁ; idempotente
  getOrder(id): Promise<Order | null>;            // forma pública: sin datos personales
  recordPayment(payment): Promise<{ firstTime; amountMatches }>;

  // panel de gestión
  listAllProducts(): Promise<Product[]>;          // incluye los pausados
  saveProduct(input): Promise<Product>;
  setStock(productId, variantId, stock): Promise<void>;
  listOrders(): Promise<AdminOrder[]>;            // del más nuevo al más viejo, con cliente e historial
  getAdminOrder(id): Promise<AdminOrder | null>;
  setOrderStatus(id, from, to, actor, reason?): Promise<AdminOrder>;
  addOrderNote(id, text, actor): Promise<AdminOrder>;
  setOrderTracking(id, tracking, actor): Promise<AdminOrder>;
  claimPurchaseEvent(id): Promise<boolean>;       // true SÓLO para el primero que llama
  expireOrders(hours, reason): Promise<number>;   // cancela los impagos y devuelve su stock
}
```

**Lo que toda implementación tiene que garantizar**

1. `createOrder` **ignora cualquier precio que venga en el pedido** y busca cada monto por su cuenta.
2. `createOrder` es **idempotente**: la misma `idempotencyKey` devuelve el mismo pedido y descuenta
   el stock una sola vez.
3. `recordPayment` acredita un pago **una sola vez** y marca el pedido como pagado sólo si el monto
   y la moneda coinciden con el total oficial.
4. `setOrderStatus` falla con `AdminError("conflict")` si el pedido ya no está en `from`, y deja el
   movimiento en el historial. Cancelar devuelve el stock. (Qué movimientos se permiten se decide
   antes, en `lib/orders/status.ts`, no en el adaptador.)
5. `claimPurchaseEvent` devuelve `true` exactamente una vez por pedido.
6. `getOrder` nunca devuelve datos personales; `getAdminOrder` sólo se llama detrás de una sesión.
7. Cancelar o vencer un pedido devuelve **sólo el stock que ese pedido descontó de verdad**, una vez.
8. Un pago sobre un pedido **cancelado** queda en su historial y se informa
   (`orderStatus: "cancelled"`); nunca se acredita.

### `json` (por defecto)

El catálogo es `content/products.json`.

- **En local** (`next dev`, o `next start` sin `APP_ENV=production`): guarda de verdad, en archivos
  dentro de `DATA_DIR` (`.data/` por defecto): `orders.json`, `catalog.json` y `uploads/`. La
  primera vez siembra pedidos de ejemplo en todos los estados (`DEMO_ORDERS=false` para arrancar
  vacío). `npm run data:export` copia el catálogo editado a `content/products.json`.
- **En producción**: sólo lectura. Los pedidos no se guardan —cada uno viaja al comprador como un
  comprobante firmado y le llega al dueño por WhatsApp o por correo— y el panel muestra pedidos de
  ejemplo con el aviso «modo demo: los cambios no se guardan; conectá una base de datos».

### `supabase` y `postgres`

Los dos usan el mismo esquema, [`db/schema.sql`](../db/schema.sql) (se corre una vez; se puede
volver a correr sin riesgo), y el mismo código (`lib/data/sql.ts`). Sólo cambia el transporte:
`supabase` llama a la API REST del proyecto con `fetch` (clave pública para las vistas de lectura
y clave de servicio —sólo en el servidor— para las funciones); `postgres` usa el driver `pg`
contra `DATABASE_URL`.

Necesita PostgreSQL 15 o más nuevo. El esquema: tablas con **seguridad por fila activada**;
políticas de sólo lectura en las tres tablas del catálogo; dos vistas públicas de lectura
(`public_catalog`, `public_categories`) con `security_invoker`, así nunca sirven para escribir; un
bloque de permisos que primero **revoca todo** a los roles públicos (Supabase crea los objetos con
todos los permisos para ellos) y después concede sólo `select` sobre el catálogo; y funciones para
cada escritura
—`create_order`, `record_payment`, `set_order_status`, `add_order_note`, `set_order_tracking`,
`claim_purchase_event`, `save_product`, `set_stock`, `expire_orders`— más `admin_orders` y `admin_catalog` para el
panel. Las funciones sólo las pueden ejecutar el dueño de la base y el rol de servicio.

Las pruebas corren este SQL real sobre un PostgreSQL en proceso (`tests/sql.test.ts`).

### Sumar un adaptador de datos (otra base, un CMS, tu CRM)

1. Crear `lib/data/<nombre>.ts` que exporte un `DataAdapter`. Para una base SQL alcanza con
   implementar un `SqlGateway` y llamar a `sqlAdapter("<nombre>", gateway)`.
2. Registrarlo en `load()` de `lib/data/index.ts` y sumar el nombre a `DATA_SOURCE` en `lib/env.ts`.
3. Sumar sus variables a `lib/env.ts` (validadas) y a `.env.example` (explicadas).
4. Probar las garantías de arriba. `tests/admin-orders.test.ts` y `tests/sql.test.ts` sirven
   de modelo.

## Pagos

```ts
interface PaymentAdapter {
  readonly id: string;
  methods(): PaymentMethod[];                    // lo que ofrece el checkout
  start(ctx): Promise<{ type: "instructions" } | { type: "redirect"; url }>;
  parseWebhook(req): Promise<{ type: "invalid" } | { type: "ignored" } | { type: "payment"; … }>;
  lookup?(orderId, params): Promise<PaymentRecord | null>;
}
```

- `manual` — sin procesador: transferencia o coordinar por WhatsApp. El dueño confirma el pago en
  el panel («Confirmar pago»).
- `mercadopago` — Checkout Pro (página del procesador) + un webhook que verifica `x-signature`.
- `stripe` — Checkout Session (página del procesador) + un webhook que verifica `Stripe-Signature`.

El webhook vive en `/api/payments/<proveedor>/webhook` y siempre sigue el mismo camino
(`lib/payments/credit.ts`): **verificar la firma → preguntarle a la API del procesador qué pasó de
verdad → comparar el monto con el total oficial → acreditar una sola vez**. El total viaja al
procesador sellado con un HMAC (`sealTotal`), así la comparación funciona aun sin base de datos.

Para sumar un procesador: implementar `PaymentAdapter`, registrarlo en `lib/payments/index.ts` y
sumar su nombre y sus secretos obligatorios a `lib/env.ts`. El checkout y la ruta del webhook no
cambian. Siempre hacé un pago real de punta a punta antes de salir.

## Correo, fotos y antibots

- **Correo** (`send(mail): Promise<boolean>`, nunca tiene que tirar un error): `console` sólo
  registra; `resend` usa su API HTTP; `smtp` usa cualquier servidor SMTP (`SMTP_URL`).
- **Fotos** (`put(name, bytes, contentType): Promise<url>`): `local` escribe en `DATA_DIR/uploads`
  y lo sirve en `/media/<archivo>` (necesita un disco persistente); `supabase` escribe en un bucket
  público de Storage. El almacenamiento compatible con S3 está en el roadmap.
- **Antibots** (`verify(token, ip): Promise<boolean>`): `none` o `turnstile`. El token es de un
  solo uso: después de cada envío el formulario espera uno fresco.

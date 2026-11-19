[English](admin.md) · **Español**

# El panel de gestión

`/admin` es la herramienta de todos los días del negocio: acá entran los pedidos, se cobran, se
preparan, se envían y se entregan. Funciona en el celular y en la computadora.

| Ruta | Pantalla |
|---|---|
| `/admin/login` | Ingreso |
| `/admin` | **Kanban de pedidos** (la pantalla principal) |
| `/admin/summary` | Ventas: hoy / 7 días / 30 días, gráfico y más vendidos |
| `/admin/products`, `/admin/products/new`, `/admin/products/<id>` | Lista de productos con stock editable; crear y editar |
| `/admin/customers` | Clientes, armados a partir de los pedidos |
| `/admin/settings` | Sólo lectura: adaptadores activos y qué falta |
| `/admin/orders/<id>/print` (`?doc=label`) | Remito o etiqueta de envío para imprimir |

## Acceso

No hay proveedor de identidad externo. Los usuarios viven en la variable de entorno `ADMIN_USERS`
como pares `email:hash`, donde el hash es **scrypt** (`node:crypto`).

```bash
npm run admin:hash
# Admin e-mail: vos@example.com
# Password (8+ characters): ********
# → vos@example.com:scrypt.<sal>.<hash>      ← esto va en ADMIN_USERS
```

- La sesión es una **cookie firmada** (HMAC-SHA256 con `ADMIN_SESSION_SECRET`): `httpOnly`,
  `SameSite=Lax`, `Secure` en https / producción, 12 horas. El secreto es obligatorio en
  producción; no existe ninguna clave incorporada que pueda firmar una sesión con permiso de
  escritura.
- Los ingresos fallidos se limitan a 5 por e-mail (desde cualquier dirección) y 20 por dirección
  cada 15 minutos. La dirección se toma sólo de una fuente de confianza (`TRUSTED_PROXY_HEADER`).
- `proxy.ts` redirige `/admin/*` al ingreso y responde 401 en `/api/admin/*` si no hay una cookie
  válida — **y cada página y cada ruta vuelve a verificar la sesión por su cuenta**.
- Las escrituras además exigen el origen de la propia tienda y un admin de verdad.
- Todo el panel es `noindex` (etiqueta meta y `X-Robots-Tag`) y está bloqueado en `robots.txt`.

**Modo demo** (`DEMO_MODE=true`, o solo mientras la tienda es una demo sin configurar): la pantalla
de ingreso muestra un usuario de sólo lectura (`demo@example.com` / `demo`). Puede abrir todas las
pantallas y no puede cambiar nada: el servidor rechaza sus escrituras con 403. En una tienda real
va `DEMO_MODE=false`.

## El kanban

Columnas: **Nuevo → Pagado → En preparación → Listo / Enviado → Entregado**. Los cancelados quedan
plegados aparte. Cada tarjeta muestra el número, el cliente, el total, los ítems, el medio y el
estado del pago, la forma de entrega y hace cuánto entró.

Para mover una tarjeta:

- **Computadora**: se arrastra con el ratón. Las columnas válidas se iluminan; las otras se apagan.
- **Celular**: el menú «Mover a…» de la tarjeta (un selector nativo). No hay arrastre táctil a
  propósito: pelea con el scroll. Las columnas se desplazan hacia el costado.
- **Teclado**: con el foco en una tarjeta, `Shift + →` / `Shift + ←`; `Enter` la abre. El menú
  también funciona.

Los movimientos permitidos son una sola tabla, `lib/orders/status.ts`: un pedido tiene que estar
pagado antes de prepararse, un paso se puede deshacer antes de la entrega, un pedido pagado nunca
vuelve a «Nuevo» y «Cancelado» es final (pide un motivo y devuelve el stock). El servidor revisa
cada movimiento y lo deja en el **historial** del pedido con quién lo hizo y cuándo. Si dos
personas actúan a la vez, la segunda recibe «otra persona ya cambió este pedido» y la lista
actualizada.

Filtros: texto (número, cliente, e-mail, teléfono), medio de pago y fecha.

**Los pedidos impagos vencen.** Un pedido que sigue en «Nuevo» después de `ORDER_EXPIRY_HOURS`
(48 por defecto) pasa a «Cancelado» con el motivo «vencido» y devuelve su stock. Si después entra
plata para un pedido cancelado, **no** se acredita: la tarjeta muestra «Pago recibido: revisar»,
queda en el historial y al dueño le llega un correo para reembolsarlo o coordinar con el cliente.

## Recepción en vivo

El tablero le pregunta al servidor si hubo cambios cada 15 segundos
(`GET /api/admin/orders?v=<versión>`; si no cambió nada, la respuesta pesa unos pocos bytes).
Funciona con cualquier adaptador de datos. Cuando entra un pedido nuevo:

- su tarjeta aparece en «Nuevo», resaltada;
- la pestaña del navegador muestra un contador: `(2) Pedidos`;
- suena un aviso corto, si lo activaste (el botón del parlante);
- aparece la notificación del navegador, si diste permiso (el botón de la campana) y la pestaña
  está en segundo plano;
- al dueño le llega un correo (`ORDER_NOTIFY_EMAIL` + un adaptador de correo).

## Detalle del pedido

Un panel lateral en la computadora y una hoja desde abajo en el celular. Ítems con su variante,
cliente y enlaces de contacto, entrega y dirección, pago, línea de tiempo, notas internas y las
acciones: confirmar el pago a mano (pagos manuales), pasar al estado siguiente, cancelar con
motivo, guardar y copiar el código de seguimiento, imprimir el remito o la etiqueta y escribirle
al cliente por WhatsApp con un mensaje armado según el estado.

Cuando un pedido pasa a **Pagado** —a mano desde acá o por el webhook de un procesador— la compra
se informa a la API de conversiones **una sola vez**: el adaptador guarda que ya se mandó y el id
del pedido es el `event_id`.

## Dónde se guardan los cambios

| Adaptador de datos | El panel |
|---|---|
| `supabase`, `postgres` | Guarda de verdad |
| `json`, en local | Guarda en archivos dentro de `DATA_DIR` |
| `json`, en producción | Sólo lectura, con pedidos de ejemplo y el aviso «modo demo: los cambios no se guardan; conectá una base de datos» |

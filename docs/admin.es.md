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

Columnas: **Consultas → Nuevo → Pagado → En preparación → Listo / Enviado → Entregado**. Los
cancelados quedan plegados aparte. Cada tarjeta muestra el número, el cliente, el total, los
ítems, el medio y el estado del pago, la forma de entrega (sólo si hay algo para enviar), el
**turno** de un servicio y hace cuánto entró.

**Consultas** es la columna de los productos sin precio público: una tarjeta ahí todavía no es un
pedido. No se puede arrastrar a otra columna —pasa sola a «Nuevo» cuando el cliente acepta el
presupuesto— y sólo se puede cancelar. Ver [Presupuestos](#presupuestos).

Para mover una tarjeta:

- **Computadora**: se arrastra con el ratón. Las columnas válidas se iluminan; las otras se apagan.
- **Celular**: el menú «Mover a…» de la tarjeta (un selector nativo). No hay arrastre táctil a
  propósito: pelea con el scroll. Las columnas se desplazan hacia el costado.
- **Teclado**: con el foco en una tarjeta, `Shift + →` / `Shift + ←`; `Enter` la abre. El menú
  también funciona.

Los movimientos permitidos son una sola tabla, `lib/orders/status.ts`: un pedido tiene que estar
pagado antes de prepararse, un paso se puede deshacer antes de la entrega, un pedido pagado nunca
vuelve a «Nuevo», un pedido sin nada para enviar (un servicio, una descarga) —y sólo ese— puede pasar de
«Pagado» directo a «Entregado» y «Cancelado» es final (pide un motivo y devuelve el stock). El servidor revisa
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

## Presupuestos

Cuando un cliente pide un presupuesto, la consulta aparece en **Consultas** con lo que escribió.
Al abrirla está el editor del presupuesto:

1. Cargá un **precio unitario** para cada línea y el **envío**. El total se actualiza mientras
   escribís (el oficial lo calcula el servidor al guardar).
2. **Guardar** deja los precios sin avisarle al cliente. **Guardar y enviar** además marca el
   presupuesto como enviado y, **si hay un proveedor de correo configurado**, le manda al cliente
   un e-mail con un enlace firmado. El panel dice si el e-mail salió de verdad. En cualquier caso
   el editor muestra ese enlace, con **Copiar enlace** y **Mandar por WhatsApp** (un mensaje ya
   escrito al teléfono del cliente), así el presupuesto siempre se puede entregar.
3. El cliente abre el enlace, ve el presupuesto y lo acepta eligiendo cómo pagar, y dando la
   dirección de entrega si el presupuesto cobra envío. La tarjeta pasa
   a «Nuevo» y desde ahí es un pedido como cualquier otro: confirmar el pago, preparar, entregar.

Hasta que no se envía, el cliente no puede aceptarlo ni pagarlo. Si cambiás un precio después de
enviarlo, el presupuesto **deja de estar enviado**: hay que mandarlo de nuevo. El cliente sólo
puede aceptar el total exacto de lo último que se envió. Cada guardado y cada envío queda en el
historial del pedido. Una consulta no vence sola: cancelá las que no llegan a nada.

## Agenda

`/admin/agenda` muestra todos los turnos reservados de los productos `service`, en la zona
horaria de la tienda (`commerce.booking.timeZone`):

- **Semana**: siete columnas en la computadora y una lista de días en el celular. Cada día dice
  cuántos lugares quedan libres.
- **Día**: los turnos de un día. Tocá el nombre de un día para abrirlo.
- Cada turno muestra la hora, el servicio, el cliente, los lugares, si está pagado y el número de
  pedido; al tocarlo se abre el pedido.

Un turno es una línea de un pedido: cancelar el pedido libera el turno, y un pedido impago deja
de retenerlo cuando vence la retención (`booking.holdHours`, 12 por defecto): la Agenda deja de
mostrarlo en el acto. Es una agenda por servicio, no por profesional. La Agenda necesita un
adaptador que guarde pedidos; en la demo de sólo lectura muestra turnos de ejemplo. Los horarios, los días cerrados y hasta
cuándo se abre la agenda se configuran en `config/commerce.ts` (ver
[`product-types.es.md`](product-types.es.md)). Todavía no está hecho: crear un turno a mano desde
el panel, moverlo y los recordatorios.

## Productos de cualquier tipo

Un producto marcado como **Borrador** (todavía falta el precio) muestra **Falta el precio** en la
lista y no está en la tienda hasta que se carga el precio y se destilda la casilla (su campo de
precio arranca vacío; el precio 0 se rechaza en todo lo que está a la venta, salvo que la casilla
**Gratis** diga que es a propósito). Un servicio con
**Cómo se reserva → Evento o taller** se vende por inscripción a sus propias fechas —una regla que
se repite («el primer sábado de cada mes»), fechas sueltas, o las dos— y sus inscripciones se ven
en la Agenda, que tiene **Próximo evento** e **Ir a una fecha**. Cuando al guardar se quita una
fecha que ya tenía inscripciones, el editor dice cuál.

El editor de productos tiene un bloque **Tipo y forma de venta**: físico (unidad de medida, paso,
mínimo y máximo), digital (el archivo privado y el nombre que ve el cliente), servicio (duración
y cupo por turno) y a presupuesto (sin precio público). El detalle está en
[`product-types.es.md`](product-types.es.md).

## Dónde se guardan los cambios

| Adaptador de datos | El panel |
|---|---|
| `supabase`, `postgres` | Guarda de verdad |
| `json`, en local | Guarda en archivos dentro de `DATA_DIR` |
| `json`, en producción | Sólo lectura, con pedidos de ejemplo y el aviso «modo demo: los cambios no se guardan; conectá una base de datos» |

[English](go-live.md) · **Español**

# De cero a vender

Esta guía lleva una tienda hecha con Cerebro Web de «anda en mi compu» a «recibe pedidos de
verdad». Está escrita para que **un agente de IA lleve al dueño de la mano**: cada paso dice qué
preguntarle al dueño (🧑), qué hace el agente (🤖) y cómo saber que salió bien (✅).

Tres reglas para el agente:

1. **Corré `npm run doctor` primero, y después de cada paso.** Lee la configuración y dice qué
   está listo y cuál es el único paso que sigue. (Lee `.env.local`; si la tienda ya está en un
   hospedaje, bajá antes sus variables: en Vercel, `vercel env pull .env.local`.)
2. **Las claves las crea y las pega el dueño**, en la configuración de su hospedaje. Nunca van al
   repositorio, y tampoco conviene que las pegue en un chat.
3. **Las pantallas de cada proveedor cambian.** Esta guía dice qué buscar, no dónde está cada
   botón; cada paso enlaza la documentación oficial del proveedor. Si un nombre no coincide,
   creele a su página.

No hace falta todo para arrancar: los pasos 1 a 6 dejan una tienda que guarda pedidos y cobra
por transferencia o por mensaje. Las tarjetas (7), el correo (8) y el dominio (9) pueden venir
enseguida después.

## 0. Antes de empezar

- 🧑 Tener una cuenta de e-mail del negocio y decidir a nombre de quién van las cuentas (son del
  dueño, no del agente).
- 🤖 La tienda ya está adaptada: marca, catálogo y reglas comerciales
  ([`GETTING-STARTED.es.md`](../GETTING-STARTED.es.md)), **con los datos reales**: el e-mail, el
  WhatsApp, la dirección y los datos bancarios reales van en `config/brand.ts` y
  `config/commerce.ts`. `npm run check` y `npm run build` los aceptan: el control de «datos de
  una marca privada» protege sólo el repositorio de la plantilla y en una tienda se saltea.
  `npm run check` pasa.
- 🤖 El código está en un repositorio de GitHub del dueño (el hospedaje publica desde ahí):
  <https://docs.github.com/es/repositories/creating-and-managing-repositories/creating-a-new-repository>.

## 1. Una base de datos, para guardar los pedidos

Sin base de datos la tienda no guarda nada: es el modo de demostración. Los servicios, los
eventos, los presupuestos y los digitales la **necesitan**.

- 🧑 Crear una cuenta gratis y un proyecto en Supabase: <https://supabase.com/docs/guides/getting-started>.
  Elegir una región cercana a los clientes y guardar la contraseña de la base en un lugar seguro.
  (También sirve cualquier PostgreSQL: `DATA_SOURCE=postgres` y `DATABASE_URL`.)
- 🧑 En la configuración de API del proyecto, copiar tres valores —la URL del proyecto, la clave
  pública («anon» / publicable) y la clave secreta («service role»)—:
  <https://supabase.com/docs/guides/api/api-keys>. La clave secreta es una contraseña: sólo va en
  las variables del hospedaje.
- ✅ Tenés: `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Cargar el esquema

- 🤖 Abrir el editor de SQL del proyecto (<https://supabase.com/docs/guides/database/overview>),
  pegar todo [`db/schema.sql`](../db/schema.sql) y ejecutarlo. Se puede correr dos veces.
- 🤖 Para arrancar con los productos de `content/products.json`, correr `npm run db:seed` y
  después pegar y ejecutar [`db/seed.sql`](../db/seed.sql). Desde ahí los productos se editan en
  `/admin/products`.
- ✅ Existen las tablas `products`, `orders` y las demás, y `select count(*) from products`
  responde.

## 3. El bucket privado (sólo si vendés archivos digitales)

- 🧑 En Storage, crear un bucket llamado `downloads` y dejarlo **privado** (no público):
  <https://supabase.com/docs/guides/storage/buckets/fundamentals>. Para las fotos de los
  productos, crear otro, `products`, **público**.
- 🤖 Variables: `STORAGE_PROVIDER=supabase`, y `SUPABASE_PRIVATE_BUCKET` /
  `SUPABASE_STORAGE_BUCKET` sólo si usaste otros nombres.
- ✅ El servidor se niega a usar un bucket público para los archivos que se venden: si una
  descarga falla, el log dice por qué.

## 4. Las variables, en el hospedaje

- 🧑 Crear el proyecto en el hospedaje a partir del repositorio de GitHub. En Vercel:
  <https://vercel.com/docs/getting-started-with-vercel/import>. También sirve cualquier servidor
  Node o Docker ([`docs/deploy.es.md`](deploy.es.md)).
- 🤖 Generar un secreto al azar para que el dueño lo pegue: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
  (uno para `ORDER_SECRET` y otro para `ADMIN_SESSION_SECRET`).
- 🧑 En las variables de entorno del proyecto (<https://vercel.com/docs/environment-variables>)
  agregar:

  | Variable | Valor |
  |---|---|
  | `DATA_SOURCE` | `supabase` |
  | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | las del paso 1 |
  | `ORDER_SECRET` | el primer secreto al azar |
  | `NEXT_PUBLIC_SITE_URL` | la dirección pública, `https://…` (por ahora, la del hospedaje) |
  | `ORDER_EXPIRY_HOURS`, `BOOKING_HOLD_HOURS` | sólo para cambiar los valores de fábrica (48 y 12) |

- ✅ Después del próximo despliegue, la tienda abre y un pedido de prueba aparece en `/admin`
  (antes, el paso 5). Cada variable está explicada en [`.env.example`](../.env.example).

## 5. El usuario del panel

- 🤖 Correr `npm run admin:hash` en tu computadora. Pide el e-mail del dueño y una contraseña (la
  escribe el dueño; 8 caracteres o más) y devuelve una línea: `email:scrypt.…`.
- 🧑 Agregar `ADMIN_USERS` = esa línea, y `ADMIN_SESSION_SECRET` = el segundo secreto al azar.
- ✅ `/admin/login` acepta ese e-mail y esa contraseña. Más usuarios: varias líneas separadas por
  comas.

## 6. Apagar la demo

- 🧑 Agregar `DEMO_MODE=false`. (Dejar `DEMO_ORDERS` sin definir: los pedidos de ejemplo son para
  las demos.)
- ✅ La pantalla de ingreso ya no ofrece el usuario de demostración, la portada ya no muestra el
  bloque «Estás viendo una demo» y el panel arranca sin pedidos. Hacé un pedido de prueba real,
  pasalo a «Pagado» y cancelalo.

## 7. Cobros

De fábrica la tienda cobra por transferencia o coordinando por WhatsApp: completá los datos
bancarios en `config/commerce.ts`. Para cobrar con tarjeta, uno de estos (los dos llevan al
comprador a la página del propio proveedor):

- **Mercado Pago** — 🧑 crear la aplicación y copiar el access token de producción:
  <https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/overview>. Configurar el webhook
  hacia `https://TU-DOMINIO/api/payments/mercadopago/webhook` para los eventos de pagos y copiar
  su clave secreta:
  <https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks>.
  Variables: `PAYMENT_PROVIDER=mercadopago`, `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET`.
- **Stripe** — 🧑 copiar la clave secreta (<https://docs.stripe.com/keys>) y crear un webhook
  hacia `https://TU-DOMINIO/api/payments/stripe/webhook` para los eventos
  `checkout.session.completed` y `checkout.session.async_payment_succeeded`; después copiar su
  secreto de firma (<https://docs.stripe.com/webhooks>). Variables: `PAYMENT_PROVIDER=stripe`,
  `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
- ✅ **Pagar un pedido real y chico de punta a punta** (primero en el modo de prueba del
  proveedor, si lo tiene): el pedido tiene que pasar solo a «Pagado». La tienda nunca marca un
  pedido como pagado sin un aviso firmado por el total exacto.

## 8. Correo

Sin esto no sale ningún e-mail: ni la confirmación del pedido, ni los presupuestos, ni los enlaces
de descarga.

- 🧑 Crear una cuenta en Resend, verificar el dominio desde el que vas a enviar y crear una clave
  de API: <https://resend.com/docs/dashboard/domains/introduction> ·
  <https://resend.com/docs/dashboard/api-keys/introduction>. (También sirve cualquier casilla
  SMTP: `MAIL_PROVIDER=smtp` y `SMTP_URL`.)
- 🧑 Variables: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (`Tienda <pedidos@tu-dominio>`)
  y `ORDER_NOTIFY_EMAIL` = adónde quiere el dueño que le avisen de cada pedido.
- ✅ Un pedido de prueba manda dos e-mails: uno al comprador y otro al dueño.

## 9. El dominio

- 🧑 Comprar el dominio (o usar uno que ya tengas) y agregarlo al proyecto del hospedaje,
  siguiendo sus instrucciones para los registros DNS:
  <https://vercel.com/docs/domains/working-with-domains/add-a-domain>.
- 🧑 Cambiar `NEXT_PUBLIC_SITE_URL` por la dirección definitiva (`https://www.tu-dominio…`) y
  volver a desplegar. Actualizar las direcciones de los webhooks del paso 7 si usaban la anterior.
- ✅ La tienda abre en el dominio con el candado, y el enlace de un pedido en un e-mail apunta ahí.

## 10. Abrir las puertas

- 🤖 `npm run doctor` dice que está todo listo. `npm run check` no lista borradores (productos sin
  precio) ni textos de EJEMPLO.
- 🤖 Las páginas legales están completas con lo que confirmó el dueño (términos, privacidad,
  cambios y devoluciones).
- 🧑 Comprar algo vos mismo, desde un celular, y seguirlo en `/admin` hasta entregarlo.
- 🧑 Recién ahora: `ALLOW_INDEXING=1`, para que los buscadores puedan listar la tienda. Después,
  [`GETTING-STARTED.es.md`](../GETTING-STARTED.es.md) §10–12: consolas de buscadores, feeds de
  productos y medición.

## Si algo no anda

- `npm run doctor`: qué falta, en palabras simples.
- El log del servidor en el hospedaje: la tienda dice con claridad qué rechaza y por qué (un
  webhook sin firma, un bucket público, una variable que falta al arrancar).
- [`docs/adapters.es.md`](adapters.es.md) y [`SECURITY.md`](../SECURITY.md) para entender cada pieza.

Lo que esta guía no puede comprobar por vos: se escribió sin cuentas reales en estos proveedores.
El lado de la tienda de cada paso está probado; las pantallas de cada proveedor son de ellos, y
cambian.

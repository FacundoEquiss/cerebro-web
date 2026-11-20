[English](GETTING-STARTED.md) · **Español**

# Primeros pasos: de la plantilla a la web de un negocio

Este es el checklist ordenado. Cada paso dice **quién** lo hace:

- 🤖 **Agente** — se puede hacer desde el repositorio.
- 🧑 **Dueño** — necesita una decisión, una cuenta, plata o datos reales que sólo tiene el dueño.

El agente tiene que pedir todo lo de la columna 🧑 **en una sola tanda** al empezar (ver el
cerebro, «Preguntar sólo lo necesario») y nunca tapar un hueco con un dato inventado.

## 0. Antes de tocar nada

| | Quién | Qué |
|---|---|---|
| ☐ | 🤖 | Leer `AGENTS.es.md` y los nodos esenciales de `cerebro/dist/llms-full.txt`. |
| ☐ | 🤖 | Correrla: `npm install && npm run dev`. Comprar algo en la demo; abrir `/admin`. |
| ☐ | 🧑 | Responder la ficha del negocio: qué vendés, a quién, país, moneda, cómo entregás, cómo cobrás y por dónde te contactan. |
| ☐ | 🤖 | **Primer paso: elegí el preset más parecido a tu rubro.** `npm run preset` los lista (moda, hogar, tecnología, almacén por peso, gastronomía, servicios con turno, productos digitales, trabajos a medida, o la demo mixta); `npm run preset <nombre>` lo aplica. Reemplaza el catálogo, los textos de la portada y la paleta por **ejemplos** de ese rubro: un punto de partida, para reescribir en los pasos que siguen. Ver [`docs/product-types.es.md`](docs/product-types.es.md). |

## 1. Marca

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Nombre, slogan, logo (si hay), colores o una referencia que te guste, datos de contacto y redes. |
| ☐ | 🤖 | Completar `config/brand.ts`: nombre, slogan, descripción, `locale` (`es` o `en`), país, moneda, contacto, redes y los 8 colores del tema. Revisar el contraste (4,5:1 para el texto). |
| ☐ | 🤖 | Tipografías en `config/fonts.ts` (cualquier familia de licencia abierta). Reemplazar `app/icon.svg`. Revisar `app/opengraph-image.tsx`. |
| ☐ | 🤖 | Reescribir los textos de la portada, los beneficios y las preguntas frecuentes en `content/site.json` (lo escribe el preset; los textos de respaldo están en `i18n/<idioma>.ts`) con datos **reales**. Sacar todos los «EJEMPLO». |

## 2. Reglas comerciales

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Formas y costos de envío, monto del envío gratis, pedido mínimo, plazo de preparación, datos bancarios para transferencias y si ofrecés cuotas. |
| ☐ | 🤖 | Completar `config/commerce.ts`. Lo que no está confirmado queda apagado (`enabled: false`) o en `null`. |
| ☐ | 🧑 | **Si vendés servicios**: horarios por día, días cerrados, zona horaria, con cuánta anticipación se reserva, hasta cuándo se abre la agenda y tu política de cancelación. |
| ☐ | 🤖 | Completar `booking` en `config/commerce.ts` (y `service.weekly` en un producto con horarios propios). Reservar un turno y encontrarlo en `/admin/agenda`. |
| ☐ | 🧑 | **Si vendés por peso**: qué pasa cuando el peso real difiere del pedido. **Si vendés archivos digitales**: la licencia y la política de reembolso. **Si cotizás**: cuánto dura un presupuesto y si pedís seña. |

## 3. Productos y fotos

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | La lista de productos: nombre, descripción, **tipo** (físico, digital, servicio, a presupuesto), precio y unidad (unidad, kg, m…), precio de lista, opciones (talles, colores…) y stock; en un servicio, la duración y el cupo por turno; en un digital, el archivo. Fotos sobre las que tengas derechos (ver el cerebro, «Multimedia»). |
| ☐ | 🤖 | **Un precio que no tenés no se inventa**: cargá ese producto como borrador (`"price": null` en el archivo, o «Borrador» en el panel). No se muestra ni se vende; `npm run check:catalog` lista los borradores para llevárselos al dueño. |
| ☐ | 🤖 | Los talleres y las clases sueltas son servicios con **fechas propias**, no la agenda semanal: una regla que se repite (`service.repeat`, «el primer sábado de cada mes») o fechas sueltas (`service.sessions`). En el panel: «Cómo se reserva → Evento o taller». |
| ☐ | 🤖 | Cargarlos: editar `content/products.json` o —con una base de datos— crearlos en `/admin/products`. Las fotos que se suben por el panel se achican a WebP (1600 px) y necesitan texto alternativo. |
| ☐ | 🤖 | Borrar los productos de demo y `public/products/*.svg`. Comprobar que un producto con opciones y sin variantes igual obliga a elegir. |

## 4. Base de datos (para guardar pedidos y stock)

El modo `json` no guarda nada en producción. Para vender de verdad:

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Crear un proyecto de Supabase **o** una base PostgreSQL 14+. Pasar los datos de conexión por la configuración de secretos del hosting: nunca por chat ni en el repo. |
| ☐ | 🤖 | Correr `db/schema.sql` (y `db/seed.sql` sólo si querés el catálogo de demo). **Preguntar antes de correrlo en una base que ya tiene datos.** |
| ☐ | 🤖 | Poner `DATA_SOURCE=supabase` (+ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) o `DATA_SOURCE=postgres` (+ `DATABASE_URL`). |
| ☐ | 🤖 | Fotos: `STORAGE_PROVIDER=supabase` con un bucket **público**, o `local` en un servidor con disco persistente. |
| ☐ | 🧑 | Activar las copias de seguridad automáticas en el proveedor de la base. |

## 5. Secretos y usuario del panel

| | Quién | Qué |
|---|---|---|
| ☐ | 🤖 | Generar `ORDER_SECRET` y `ADMIN_SESSION_SECRET` (32 caracteres al azar o más, cada uno). |
| ☐ | 🧑 | Correr `npm run admin:hash` vos mismo y elegir tu contraseña (el agente no tiene que conocerla). Pegar la línea en `ADMIN_USERS`. |
| ☐ | 🤖 | Poner `DEMO_MODE=false`. Comprobar que `/admin/login` ya no muestra las credenciales de demo y que la portada ya no muestra el bloque «Estás viendo una demo». |
| ☐ | 🤖 | Dejar `DEMO_ORDERS` sin definir: los pedidos de ejemplo sólo se cargan en modo demo (si no, retendrían lugares reales de turnos reales). `DEMO_ORDERS=true` los fuerza en una compu de prueba y `false` los oculta en una demo. |
| ☐ | 🤖 | Todo el camino de acá a una tienda que cobra —base de datos, variables, cobros, correo y dominio— está en [`docs/go-live.es.md`](docs/go-live.es.md); `npm run doctor` dice cuál es el próximo paso. |

## 6. Pagos

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Decidir: `manual` (transferencia o coordinar por WhatsApp: funciona hoy y sin comisiones) o un procesador (`mercadopago`, `stripe`). Crear la cuenta y sus credenciales. |
| ☐ | 🤖 | Poner `PAYMENT_PROVIDER` y sus claves. Registrar en el procesador la URL del webhook `https://<dominio>/api/payments/<proveedor>/webhook` y cargar su secreto. |
| ☐ | 🧑🤖 | **Un pago real, de punta a punta**, por un monto chico: pagar, ver que el pedido pasa a «Pagado» en el kanban y devolverlo. Un entorno de pruebas no alcanza. |

## 7. Correo y avisos

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Una cuenta en un servicio de correo (o los datos SMTP) y la dirección que envía. |
| ☐ | 🤖 | `MAIL_PROVIDER`, su clave, `MAIL_FROM` y `ORDER_NOTIFY_EMAIL`. Hacer un pedido de prueba y confirmar que llegan los dos correos. |

## 8. Legales

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Los términos, la política de privacidad y la de cambios reales, revisados para tu país. |
| ☐ | 🤖 | Reemplazar las plantillas (`i18n` → `legal`, páginas en `app/(store)/terms`, `privacy`, `returns`) y sacarles el `noindex`. **No redactes condiciones legales por tu cuenta.** |

## 9. Dominio y hosting

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Comprar el dominio; elegir dónde hospedar (ver `docs/deploy.es.md`). |
| ☐ | 🤖 | Desplegar. Poner `NEXT_PUBLIC_SITE_URL` y `APP_ENV=production` (en Vercel es automático). HTTPS activo. |
| ☐ | 🤖 | Si el negocio tenía una web anterior: mapear cada URL vieja a la nueva en `config/redirects.ts`. |
| ☐ | 🤖 | Revisión final en un celular de verdad. Recién entonces, `ALLOW_INDEXING=1`. |

## 10. Buscadores y catálogos

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Verificar el dominio en Google Search Console y en Bing Webmaster Tools. Crear el perfil de negocio si hay local. |
| ☐ | 🤖 | Enviar `https://<dominio>/sitemap.xml`. Cargar `INDEXNOW_KEY`. Revisar `/robots.txt`, `/llms.txt` y una página de producto en la prueba de resultados enriquecidos. |
| ☐ | 🧑🤖 | Merchant Center: sumar el feed `https://<dominio>/feeds/google.xml`. Catálogo de Meta: `https://<dominio>/feeds/meta.xml`. (Son archivos distintos a propósito.) |

## 11. Medición

| | Quién | Qué |
|---|---|---|
| ☐ | 🧑 | Crear la propiedad de Analytics, el pixel y su token de la API de conversiones (y Clarity, si se quiere). |
| ☐ | 🤖 | Cargar `NEXT_PUBLIC_GA4_ID`, `GA4_API_SECRET`, `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_TOKEN` y `NEXT_PUBLIC_CLARITY_ID`. Sólo corren en producción y después de que el visitante acepta. |
| ☐ | 🤖 | Verificar en la herramienta de pruebas de cada plataforma: `view_item`, `add_to_cart`, `begin_checkout` y **un solo** `purchase` por pedido cuando pasa a «Pagado». |

## 12. Lanzamiento

Seguí el «Checklist de lanzamiento» y el «Plan de 90 días» del cerebro. La pantalla **Ajustes**
del panel (`/admin/settings`) lista lo que todavía falta para el uso real.

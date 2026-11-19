[English](deploy.md) · **Español**

# Hospedaje

Cerebro Web es una aplicación Next.js común: corre donde corra Node 22. Nada en ella depende de
una empresa de hosting.

Dos cosas valen en todos lados:

- Las variables `NEXT_PUBLIC_*` (en particular `NEXT_PUBLIC_SITE_URL`), `APP_ENV` y
  `ALLOW_INDEXING` se leen también al **compilar**, porque las páginas se prerenderizan con ellas
  (URL canónicas, `noindex`). Cargalas antes de `npm run build` y volvé a compilar si cambia alguna.
- «Producción» —la tienda real, donde pueden encenderse la medición y la indexación— es
  `APP_ENV=production` (en Vercel se detecta solo).

## Cualquier servidor Node (un VPS, un servidor propio)

```bash
git clone <tu repositorio> tienda && cd tienda
npm ci
cp .env.example .env.local      # completalo
npm run build
npm start                       # next start, puerto 3000 (PORT=8080 npm start para otro)
```

Mantenela corriendo con tu gestor de procesos (una unidad de systemd, por ejemplo) y poné adelante
un proxy inverso con HTTPS (Caddy, nginx). El proxy tiene que reenviar `Host` y `X-Forwarded-Proto`.

Con `DATA_SOURCE=json` o `STORAGE_PROVIDER=local`, `DATA_DIR` tiene que apuntar a una carpeta que
sobreviva a los despliegues.

## Docker

```bash
docker build -t mi-tienda --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com --build-arg ALLOW_INDEXING=1 .
docker run -d --name tienda -p 3000:3000 --env-file .env -v datos-tienda:/data mi-tienda
```

La imagen usa la salida «standalone» de Next, corre con un usuario sin privilegios y guarda las
fotos subidas en el volumen `/data`. Si usás los otros valores `NEXT_PUBLIC_*`, pasalos también
como `--build-arg`.

## Vercel (recomendado, no obligatorio)

Usá el botón **Deploy** del README o importá el repositorio. Cargá las variables de entorno en la
configuración del proyecto. A tener en cuenta:

- El sistema de archivos es de sólo lectura y temporal: usá `DATA_SOURCE=supabase` o `postgres`, y
  `STORAGE_PROVIDER=supabase` para las fotos.
- El límite de frecuencia en memoria cuenta por instancia: tomalo como una primera barrera
  (`lib/rate-limit.ts` explica cómo ponerle detrás un almacén compartido).
- Los despliegues de vista previa nunca son «producción»: sin medición y sin indexar.

## Lo que hay que configurar en cualquier hosting

- **Secretos.** En producción el servidor se niega a arrancar sin `ORDER_SECRET` (y sin
  `ADMIN_SESSION_SECRET` si hay usuarios del panel). Para compilar no hacen falta.
- **La dirección del visitante.** Los límites de frecuencia cuentan por dirección, y sólo una
  fuente de confianza puede decir cuál es. Con un proxy inverso adelante (lo habitual en un VPS)
  el valor por defecto —el último salto de `X-Forwarded-For`— está bien. Detrás de un CDN o de
  una plataforma, poné en `TRUSTED_PROXY_HEADER` la cabecera que esa plataforma escribe
  (`cf-connecting-ip`, `x-real-ip`, `fly-client-ip`…). Sin ningún proxy, poné `none`. En Vercel no
  hay que hacer nada.
- **Pedidos impagos.** Se cancelan después de `ORDER_EXPIRY_HOURS` (48) y devuelven el stock. Eso
  corre solo cada vez que se usa el panel o el checkout; para correrlo además con un horario,
  cargá `CRON_SECRET` y llamá desde cualquier cron:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/expire-orders`
  (en Vercel, `vercel.json` ya lo hace una vez por día).

## El cerebro

`cerebro/dist/` es un sitio estático (sin paso de compilación). Publicalo en cualquier lugar que
sirva archivos; si su dirección no es la que trae por defecto, regeneralo antes:
`BASE_URL=https://cerebro.example.com npm run brain`.

## Después del primer despliegue

1. Abrí `/admin/settings`: lista lo que todavía falta.
2. Comprá algo de punta a punta desde un celular.
3. Recién entonces poné `ALLOW_INDEXING=1` y enviá el sitemap (ver `GETTING-STARTED.es.md`).

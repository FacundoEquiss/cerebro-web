# Cerebro Web on any server that runs containers. No platform lock-in: this is plain Node.
#
#   docker build -t my-store --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com .
#   docker run -p 3000:3000 --env-file .env -v store-data:/data my-store
#
# Three kinds of values are baked in at BUILD time, because pages are pre-rendered: every
# NEXT_PUBLIC_* variable, APP_ENV and ALLOW_INDEXING. Pass them with --build-arg (and give the
# same APP_ENV / ALLOW_INDEXING at run time). Everything else is read when the container starts.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GA4_ID
ARG NEXT_PUBLIC_META_PIXEL_ID
ARG NEXT_PUBLIC_CLARITY_ID
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG APP_ENV=production
ARG ALLOW_INDEXING
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_GA4_ID=$NEXT_PUBLIC_GA4_ID \
    NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY APP_ENV=$APP_ENV ALLOW_INDEXING=$ALLOW_INDEXING \
    NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production APP_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
# Run as an unprivileged user; /data holds uploaded photos (the `local` storage adapter).
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# The example files of the digital products (served only through /api/downloads, to paid orders).
COPY --from=build --chown=app:app /app/content/downloads ./content/downloads
USER app
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

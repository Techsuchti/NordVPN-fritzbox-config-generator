# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY Web/frontend/package.json ./package.json
RUN npm install --no-audit --no-fund

COPY Web/frontend/ ./
RUN npm run build -- --config vite.config.docker.js

FROM node:22-alpine

ARG APP_VERSION=unknown
LABEL org.opencontainers.image.version="$APP_VERSION"

WORKDIR /app
COPY --from=build /app/dist /usr/share/nginx/html
COPY local-server/server.mjs /app/server.mjs

RUN mkdir -p /data

ENV PORT=8080
ENV DATA_DIR=/data
ENV DIST_DIR=/usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "/app/server.mjs"]

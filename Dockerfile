FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
# Sem esse arquivo o Vite embute undefined nas VITE_* e o dashboard abre em branco
RUN test -f apps/web/.env || (echo "ERRO: apps/web/.env ausente no contexto de build (ver DEPLOY.md passo 3)" && exit 1)
RUN npm run build && npm run web:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
CMD ["node", "apps/server/dist/index.js"]

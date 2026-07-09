FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/server apps/server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
CMD ["node", "apps/server/dist/index.js"]

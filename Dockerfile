# ---------- сборка ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build -w packages/domain \
 && npm run build -w apps/web \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/api

# ---------- рантайм ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/assets apps/api/assets
COPY --from=build /app/apps/web/dist apps/web/dist
COPY content ./content
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PORT=3000 WEB_DIST=/app/apps/web/dist
EXPOSE 3000
USER node
CMD ["node", "apps/api/dist/server.js"]

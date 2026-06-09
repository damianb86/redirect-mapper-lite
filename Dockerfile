# syntax=docker/dockerfile:1.7
FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV APP_ENV=production

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY scripts ./scripts
COPY public ./public
COPY build ./build
COPY server.mjs ./server.mjs

CMD ["npm", "run", "docker-start"]

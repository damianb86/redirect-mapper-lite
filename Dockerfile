FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV APP_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN APP_ENV=production node scripts/prisma-env.mjs generate && npm run build && npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]

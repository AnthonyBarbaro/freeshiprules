FROM node:22-alpine AS deps
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* .npmrc ./
COPY extensions/freeship-rules-discount/package.json ./extensions/freeship-rules-discount/package.json
COPY extensions/freeship-progress-bar/package.json ./extensions/freeship-progress-bar/package.json

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm cache clean --force

FROM node:22-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/extensions ./extensions
COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000

CMD ["npm", "run", "docker-start"]

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Use npm ci if lockfile exists, otherwise npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]

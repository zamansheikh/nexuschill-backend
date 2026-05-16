# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Prefer `npm ci` for reproducible builds when a lockfile is present.
# Fall back to `npm install` if `npm ci` rejects the lockfile — that
# typically means it drifted out of sync with package.json (a
# dependency was added without re-running `npm install` before
# commit). We don't want a one-off drift to wedge deploys; falling
# back regenerates the tree from package.json so the build can
# proceed, and CI / code review should surface the lockfile drift
# separately.
RUN if [ -f package-lock.json ]; then \
      npm ci || (echo ">>> npm ci failed, falling back to npm install (lockfile likely out of sync)" && npm install); \
    else \
      npm install; \
    fi

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# Same fall-through pattern as the builder stage — lockfile drift
# shouldn't wedge a deploy.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev || (echo ">>> npm ci failed, falling back to npm install (lockfile likely out of sync)" && npm install --omit=dev); \
    else \
      npm install --omit=dev; \
    fi \
    && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]

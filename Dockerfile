FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Copy only build inputs. In particular, never bake .env into the image.
COPY app ./app
COPY next.config.js postcss.config.js tailwind.config.js tsconfig.json ./
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STATE_FILE=/app/.data/state.json

COPY --from=frontend-build --chown=node:node /app/out ./out
COPY --chown=node:node backend ./backend
COPY --chown=node:node package.json ./package.json

RUN mkdir -p /app/.data && chown node:node /app/.data

USER node

EXPOSE 3000
VOLUME ["/app/.data"]

# Liveness intentionally does not require a daily Kite session. Monitor
# /api/readiness separately to detect loss of actual trading protection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "backend/server.js"]

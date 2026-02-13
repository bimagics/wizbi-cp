# ---- Base ----
FROM node:20-slim AS base
WORKDIR /app

# ---- Dependencies (Production) ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Build (with Dev Dependencies) ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY public ./public

# --- SECURITY: Run as a non-root user ---
USER node

EXPOSE 8080

# --- RELIABILITY: Add a health check ---
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]

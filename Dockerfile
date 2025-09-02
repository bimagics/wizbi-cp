# ---- base ----
FROM node:20-slim AS base
WORKDIR /app

# ---- deps (prod) ----
FROM base AS deps
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- build (dev deps + compile TS) ----
FROM base AS build
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 8080
CMD ["node","dist/index.js"]

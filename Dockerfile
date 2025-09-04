# ---- base ----
FROM node:20-slim AS base
WORKDIR /app

# ---- deps (prod) ----
FROM base AS deps
COPY package*.json ./
# Use npm install instead of ci because we don't use a lock file
RUN npm install --omit=dev

# ---- build (dev deps) ----
FROM base AS build
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 8080
CMD ["node", "dist/index.js"]

# ---- base ----
FROM node:20-slim AS base
WORKDIR /app

# ---- deps (prod) ----
FROM base AS deps
COPY package*.json ./
# אם יש lockfile נשתמש ב-ci, אחרת install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- build (dev deps + קומפילציה) ----
FROM base AS build
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# מודולים לפרודקשן בלבד
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY public ./public
COPY --from=build /app/dist ./dist

# Cloud Run מאזין ל-$PORT
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]

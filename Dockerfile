FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
# npm install (not npm ci): dev happens on macOS, which prunes linux-musl
# native optional deps from the committed lockfile; npm ci would error on
# their absence when building on linux. npm install keeps the locked versions
# and adds the correct platform binaries.
RUN npm install --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package*.json ./
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/tsconfig.json ./
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]

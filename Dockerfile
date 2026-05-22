# Build stage — install deps (needed for Bun.build at runtime)
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

# Runtime stage — minimal image
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/sensors ./sensors
COPY --from=builder /app/pipeline.json ./pipeline.json
COPY --from=builder /app/DASHBOARD_OWNER.md ./DASHBOARD_OWNER.md
EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]

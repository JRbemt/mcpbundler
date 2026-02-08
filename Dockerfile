# ---- Stage 1: Builder - Compile TypeScript ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install build-time system dependencies
RUN apk add --no-cache openssl

# Install dependencies
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate --schema=./prisma/postgres/schema.prisma

# Copy source files and build
COPY tsconfig.json ./
COPY src ./src

# Note: Build script also copies prisma files to dist/
RUN npm run build

# ---- Stage 2: Production Runtime ----
FROM node:20-alpine AS production
WORKDIR /app

# Install runtime system dependencies
RUN apk add --no-cache openssl wget

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy dependencies from builder with ownership set during copy
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

COPY --chown=nodejs:nodejs ./scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

# Switch to non-root user
USER nodejs

# Expose application port
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/status || exit 1


ENTRYPOINT ["./scripts/docker-entrypoint.sh"]

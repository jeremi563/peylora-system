# Production-ready Dockerfile for M-Pesa Payment Management Platform
FROM node:22-alpine AS base

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Install dependencies with frozen lockfile
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY . .

# Run as non-root user for container security
USER node

# Default port
EXPOSE 5000

ENV PORT=5000 \
    NODE_ENV=production

# Built-in container health check querying Phase 15 health monitor
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["npm", "start"]
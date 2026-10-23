# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM dependencies AS builder
# Next.js compiles fallback rewrites. Keep this internal hostname identical
# in local and VPS Compose. Provider credentials never enter this build.
ARG API_ORIGIN=http://ai-engine:8000
ARG KODMOD_DEPLOYMENT_ID
ENV API_ORIGIN=${API_ORIGIN} \
    KODMOD_DEPLOYMENT_ID=${KODMOD_DEPLOYMENT_ID}
COPY apps/web ./apps/web
RUN npm run build:web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_ORIGIN=http://ai-engine:8000
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

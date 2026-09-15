# ---------- Build ----------
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

# As dependencias sao copiadas antes do codigo para que a camada de install
# seja reaproveitada quando so o fonte muda.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN pnpm build && pnpm prune --prod

# ---------- Runtime ----------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# O securityContext do Deployment exige runAsUser 1001 e runAsNonRoot.
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app

EXPOSE 3000

# O Kubernetes ja cobre a saude do container pelas probes; este healthcheck
# serve ao uso local com docker compose.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]

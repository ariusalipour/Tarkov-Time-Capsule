FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
ENV VITE_API_URL=/
RUN npm run build

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS api
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
RUN npm test && npm run build && mkdir /runtime-data

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/tarkov-time-capsule.sqlite STATIC_DIR=/app/public SCHEDULER_ENABLED=false
WORKDIR /app
COPY --from=api /app/api/dist/ ./dist/
COPY --from=web /app/web/dist/ ./public/
COPY --from=api --chown=1000:1000 /runtime-data/ /data/
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/server.mjs"]

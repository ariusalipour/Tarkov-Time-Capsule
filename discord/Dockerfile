FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS test
WORKDIR /app
COPY --chown=node:node *.mjs commands.json package.json ./
RUN node --test test.mjs
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a
WORKDIR /app
COPY --from=test /app/server.mjs /app/subscriptions.mjs /app/replay.mjs ./
USER 1000:1000
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["server.mjs"]

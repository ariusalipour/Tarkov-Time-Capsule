FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS test
WORKDIR /app
COPY --chown=node:node . ./
RUN node --test updates.test.mjs
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a
WORKDIR /app
COPY --from=test /app/updates.mjs ./
USER 1000:1000
ENV NODE_ENV=production
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["updates.mjs"]

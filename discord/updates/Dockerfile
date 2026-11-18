FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS test
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

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
COPY --chown=node:node . ./
RUN node --test updates.test.mjs
USER node
ENV NODE_ENV=production
CMD ["node", "updates.mjs"]

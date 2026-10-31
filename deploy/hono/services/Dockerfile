FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS dependencies
WORKDIR /app
RUN npm install --global vite-plus@1.1.0
COPY . .
RUN vp install -- --frozen-lockfile --filter @quorem/runner... --prod
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies --chown=node:node /app /app
USER node
CMD ["node", "--experimental-strip-types", "deploy/hono/services/start.mjs"]

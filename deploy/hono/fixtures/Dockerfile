FROM docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d AS dockercli
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
RUN npm install --global vite-plus@1.5.1
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY . .
RUN vp install --frozen-lockfile && chown -R node:node /app
USER node
CMD ["sleep", "infinity"]

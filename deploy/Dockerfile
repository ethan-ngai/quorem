FROM golang:1.27.1-bookworm AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/api apps/api
COPY apps/runner apps/runner
COPY internal internal
RUN CGO_ENABLED=0 go build -o /out/api ./apps/api/cmd/api \
 && CGO_ENABLED=0 go build -o /out/provision ./apps/api/cmd/provision \
 && CGO_ENABLED=0 go build -o /out/runner ./apps/runner/cmd/runner

FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io nginx python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go-build /out bin
COPY apps/auth apps/auth
COPY packages/contracts packages/contracts
ADD deploy/runtime-deps/deps.tar /app/
COPY apps/api/migrations apps/api/migrations
COPY deploy/site site
COPY deploy/images images
COPY deploy/start.py deploy/nginx.conf deploy/
ENV APP_ENV=production AUTH_MODE=password AUTH_PASSWORD_PRODUCTION=true AUTH_LOGIN_ONLY=true \
    AUTH_HOST=127.0.0.1 AUTH_PORT=8082 API_ADDR=127.0.0.1:8080 \
    AUTH_SERVICE_URL=http://127.0.0.1:8082 QUOREM_DEV_IDENTITY=false \
    RUNNER_IMAGE=quorem-python:production RUNNER_JAVA_IMAGE=quorem-java:production \
    RUNNER_TYPESCRIPT_IMAGE=quorem-typescript:production RUNNER_OCAML_IMAGE=quorem-ocaml:production \
    RUNNER_CONCURRENCY=2
EXPOSE 8088
ENTRYPOINT ["python3", "/app/deploy/start.py"]

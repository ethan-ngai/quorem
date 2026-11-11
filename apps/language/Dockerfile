FROM python:3.12.16-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

RUN pip install --no-cache-dir basedpyright==1.40.2 nodejs-wheel-binaries==24.19.0
WORKDIR /workspace
COPY internal/execution/public/quorem_types.py ./quorem_types.pyi
RUN printf '%s\n' '{"pythonVersion":"3.12","typeCheckingMode":"basic","include":["main.py"]}' > pyrightconfig.json \
    && touch main.py && chmod -R a+rX /workspace /usr/local/lib
USER 65534:65534
ENTRYPOINT ["basedpyright-langserver", "--stdio"]

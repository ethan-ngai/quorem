FROM python:3.12.12-slim@sha256:f3fa41d74a768c2fce8016b98c191ae8c1bacd8f1152870a3f9f87d350920b7c

RUN pip install --no-cache-dir basedpyright==1.40.2 nodejs-wheel-binaries==24.19.0
WORKDIR /workspace
COPY internal/execution/public/quorem_types.py ./quorem_types.pyi
RUN printf '%s\n' '{"pythonVersion":"3.12","typeCheckingMode":"basic","include":["main.py"]}' > pyrightconfig.json \
    && touch main.py && chmod -R a+rX /workspace /usr/local/lib
USER 65534:65534
ENTRYPOINT ["basedpyright-langserver", "--stdio"]

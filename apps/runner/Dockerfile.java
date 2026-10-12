FROM eclipse-temurin:21.0.9_10-jdk-jammy@sha256:41c8a28993a03b5dd042ce1afc7973c9a98bfbbbd6336eb1e32e673b1718d99c
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
ENV QUOREM_LANGUAGE=java
COPY apps/runner/polyglot/harness.py /opt/quorem/harness.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python3", "-B", "/opt/quorem/harness.py"]

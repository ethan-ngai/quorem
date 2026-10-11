FROM python:3.12.12-slim@sha256:f3fa41d74a768c2fce8016b98c191ae8c1bacd8f1152870a3f9f87d350920b7c
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY internal/execution/public/quorem_types.py /opt/quorem/quorem_types.py
COPY apps/runner/python/harness.py /opt/quorem/harness.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python", "-B", "/opt/quorem/harness.py"]

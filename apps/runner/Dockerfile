FROM python:3.12.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY internal/execution/public/quorem_types.py /opt/quorem/quorem_types.py
COPY apps/runner/python/harness.py /opt/quorem/harness.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python", "-B", "/opt/quorem/harness.py"]

FROM python:3.14-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/srv/.cache
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY app ./app
COPY data ./data
# one-time download of the local search model (baked into the image)
RUN python -m app.retrieval || echo "model download skipped (do it at first run)"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

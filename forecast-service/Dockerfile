# SuperSCM Python Forecast Service — Railway 배포용
#
#   docker build -t superscm-forecast .
#   docker run -p 8000:8000 -e DATABASE_URL=... -e SERVICE_TOKEN=... superscm-forecast

FROM python:3.12-slim

# lightgbm 은 OpenMP 런타임이 필요합니다. 없으면 registry 가 LIGHTGBM 을 건너뜁니다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt requirements-optional.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Prophet 을 쓰려면 아래 주석을 풀고 다시 빌드합니다 (이미지가 커집니다).
# RUN pip install --no-cache-dir -r requirements-optional.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

# Railway 는 PORT 를 주입합니다.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

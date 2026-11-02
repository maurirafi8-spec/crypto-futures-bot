#!/usr/bin/env bash
set -e
SERVICE_NAME="crypto-futures-scanner"
REGION="us-east1"

echo "=== Fazendo Deploy no Google Cloud Run ($SERVICE_NAME em $REGION) ==="
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --memory=512Mi \
  --cpu=1

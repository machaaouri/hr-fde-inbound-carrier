#!/usr/bin/env bash
# Deploy bridge/ to Cloud Run. Run from Cloud Shell or a laptop with gcloud:
#   gcloud config set project PROJECT_ID
#   ./scripts/deploy-cloud-run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE="${SERVICE:-inbound-carrier-bridge}"
REGION="${REGION:-us-central1}"

PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "Set a project first: gcloud config set project PROJECT_ID" >&2
  exit 1
fi

echo "Deploying ${SERVICE} to ${REGION} in ${PROJECT}"

gcloud run deploy "$SERVICE" \
  --source ./bridge \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --memory 512Mi \
  --timeout 60 \
  --min-instances 0 \
  --set-env-vars APP_ENV=staging,LOG_LEVEL=info,TMS_HOST=tramway.proxy.rlwy.net,TMS_PORT=17159 \
  --set-secrets TMS_TOKEN=TMS_TOKEN:latest,FMCSA_API_KEY=FMCSA_API_KEY:latest,BRIDGE_API_KEY=BRIDGE_API_KEY:latest

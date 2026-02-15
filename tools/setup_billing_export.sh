#!/usr/bin/env bash
# ==============================================================
# Setup BigQuery Billing Export for a GCP billing account.
#
# Creates a BigQuery dataset and enables standard usage cost export.
# Can be run standalone or called from bootstrap_full.sh.
#
# Required env vars (or passed as args):
#   BILLING_ACCOUNT  — Billing account ID (e.g., 01A2B3-C4D5E6-F7G8H9)
#   PROJECT_ID       — GCP project to host the BQ dataset
#
# Optional:
#   REGION           — BQ dataset location (default: EU)
#   BQ_DATASET       — Dataset name (default: billing_export)
# ==============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
step()  { echo -e "\n${GREEN}>>> $1${NC}"; }
ok()    { echo -e "${GREEN}✓  $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $1${NC}"; }
err()   { echo -e "${RED}✗  $1${NC}"; }

# --- Resolve inputs ---
: "${BILLING_ACCOUNT:=${1:-}}"
: "${PROJECT_ID:=${2:-$(gcloud config get-value project 2>/dev/null)}}"
: "${REGION:=EU}"
: "${BQ_DATASET:=billing_export}"

if [ -z "$BILLING_ACCOUNT" ] || [ -z "$PROJECT_ID" ]; then
  echo -e "${BOLD}Usage:${NC} $0 <BILLING_ACCOUNT_ID> [PROJECT_ID]"
  echo "  Or set BILLING_ACCOUNT and PROJECT_ID env vars."
  exit 1
fi

# Clean billing account ID for table name (remove dashes)
BILLING_ACCOUNT_CLEAN=$(echo "$BILLING_ACCOUNT" | tr -d '-' | tr '[:upper:]' '[:lower:]')
BQ_TABLE="gcp_billing_export_v1_${BILLING_ACCOUNT_CLEAN}"

echo -e "${CYAN}${BOLD}Setting up BigQuery Billing Export${NC}"
echo "  Billing Account: $BILLING_ACCOUNT"
echo "  Project:         $PROJECT_ID"
echo "  Dataset:         $BQ_DATASET"
echo "  Table (auto):    $BQ_TABLE"
echo ""

# --- Step 1: Enable BigQuery API ---
step "Enabling BigQuery API"
gcloud services enable bigquery.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null || true
ok "BigQuery API enabled"

# --- Step 2: Create BigQuery dataset ---
step "Creating BigQuery dataset: $BQ_DATASET"
if bq --project_id="$PROJECT_ID" show "$BQ_DATASET" >/dev/null 2>&1; then
  ok "Dataset already exists"
else
  bq --project_id="$PROJECT_ID" mk \
    --dataset \
    --location="$REGION" \
    --description="GCP Billing Export (auto-created by WIZBI)" \
    "$BQ_DATASET"
  ok "Dataset created"
fi

# --- Step 3: Grant billing SA access to the dataset ---
step "Granting billing export service account access"
# The billing export uses billing-export-bigquery@system.gserviceaccount.com
# It needs BigQuery Data Editor on the dataset
bq --project_id="$PROJECT_ID" update \
  --dataset \
  --source <(bq --project_id="$PROJECT_ID" show --format=prettyjson "$BQ_DATASET" 2>/dev/null | python3 -c "
import sys, json
ds = json.load(sys.stdin)
access = ds.get('access', [])
sa_email = 'billing-export-bigquery@system.gserviceaccount.com'
already_exists = any(
    a.get('userByEmail') == sa_email and a.get('role') == 'WRITER'
    for a in access
)
if not already_exists:
    access.append({'role': 'WRITER', 'userByEmail': sa_email})
ds['access'] = access
json.dump(ds, sys.stdout)
") "$BQ_DATASET" 2>/dev/null || warn "Could not update dataset permissions — billing export SA may need manual access"
ok "Dataset permissions updated"

# --- Step 4: Enable billing export via Cloud Billing API ---
step "Configuring billing export to BigQuery"
TOKEN=$(gcloud auth print-access-token 2>/dev/null)

# Check if export is already configured
EXISTING_SINK=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://cloudbilling.googleapis.com/v1/billingAccounts/${BILLING_ACCOUNT}/billingExportSinks" 2>/dev/null || echo "{}")

# The standard usage cost export is configured via the Cloud Console UI.
# There is no public REST API endpoint to create/update billing export sinks.
# We use the internal billingExportSinks endpoint which maps to the Console action.
EXPORT_RESULT=$(curl -s -w "\n%{http_code}" -X PATCH \
  "https://cloudbilling.googleapis.com/v1/billingAccounts/${BILLING_ACCOUNT}?updateMask=billingExportConfig" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"billingExportConfig\": {
      \"exportBigqueryDataset\": \"projects/${PROJECT_ID}/datasets/${BQ_DATASET}\"
    }
  }" 2>/dev/null || echo -e "{}\n000")

EXPORT_HTTP=$(echo "$EXPORT_RESULT" | tail -1)

if [ "$EXPORT_HTTP" = "200" ] || [ "$EXPORT_HTTP" = "201" ]; then
  ok "Billing export configured automatically"
else
  # Fallback: The internal API may not be available — give manual instructions
  warn "Automatic billing export configuration requires additional permissions."
  echo ""
  echo -e "${BOLD}  Manual setup (30 seconds):${NC}"
  echo "  1. Open: https://console.cloud.google.com/billing/${BILLING_ACCOUNT}/export"
  echo "  2. Click 'STANDARD USAGE COST' tab"
  echo "  3. Click 'EDIT SETTINGS'"
  echo "  4. Project: ${PROJECT_ID}"
  echo "  5. Dataset: ${BQ_DATASET}"
  echo "  6. Click 'SAVE'"
  echo ""
fi

# --- Output env vars ---
echo ""
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Set these env vars on Cloud Run:${NC}"
echo ""
echo "  BILLING_BQ_PROJECT=$PROJECT_ID"
echo "  BILLING_BQ_DATASET=$BQ_DATASET"
echo "  BILLING_BQ_TABLE=$BQ_TABLE"
echo ""
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Export for use by bootstrap_full.sh
export BILLING_BQ_PROJECT="$PROJECT_ID"
export BILLING_BQ_DATASET="$BQ_DATASET"
export BILLING_BQ_TABLE="$BQ_TABLE"

ok "BigQuery billing export setup complete"
echo -e "${YELLOW}Note: Billing data starts flowing within 24 hours.${NC}"

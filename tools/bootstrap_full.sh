#!/usr/bin/env bash
# ==============================================================
# WIZBI Control Plane — Full Bootstrap Script (Interactive)
# ==============================================================
# One-click deployment for a bare GCP project.
# Designed to run in Google Cloud Shell via "Open in Cloud Shell" button.
#
# Minimal input needed:
#   - Billing Account ID
#   - Project ID (optional, auto-generated with unique suffix)
#
# All API keys (GitHub App, etc.) can be configured AFTER
# deployment through the Admin Panel Settings tab.
# ==============================================================
set -euo pipefail

# =========================================
# Color helpers
# =========================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

phase()  { echo -e "\n${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${CYAN}${BOLD}  $1${NC}"; echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
step()   { echo -e "\n${GREEN}>>> $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠  $1${NC}"; }
err()    { echo -e "${RED}✗  $1${NC}"; }
ok()     { echo -e "${GREEN}✓  $1${NC}"; }

# =========================================
# PHASE 0 — Auto-detect everything
# =========================================
phase "WIZBI Control Plane — Setup Wizard"

echo -e "${BOLD}Welcome! Setting up your WIZBI Control Plane on GCP.${NC}"
echo -e "Everything is automatic. Sit back and relax.\n"

# --- Required tools check ---
REQUIRED_TOOLS=(gcloud gsutil curl npm git)
for cmd in "${REQUIRED_TOOLS[@]}"; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Required tool '$cmd' is not installed or not in PATH."
    err "Please install it and try again."
    exit 1
  fi
done
ok "All required tools found: ${REQUIRED_TOOLS[*]}"

if [ "${CLOUD_SHELL:-}" != "true" ]; then
  warn "It looks like you are NOT running in Google Cloud Shell."
  warn "This script is optimized for Cloud Shell execution."
  warn "Run in Cloud Shell: https://console.cloud.google.com"
  read -rp "Continue anyway? [y/N] " FORCE_RUN
  if [[ ! "$FORCE_RUN" =~ ^[Yy]$ ]]; then exit 1; fi
fi

# --- Auto-detect everything ---

# Project ID: auto-generate unique
RANDOM_SUFFIX=$(head -c 100 /dev/urandom | tr -dc 'a-z0-9' | head -c 4)
: "${PROJECT_ID:=wizbi-cp-${RANDOM_SUFFIX}}"

# Region: default
: "${REGION:=europe-west1}"

# Admin Email: auto-detect from gcloud
if [ -z "${ADMIN_EMAIL:-}" ]; then
  ADMIN_EMAIL=$(gcloud config get-value account 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
  if [ -z "$ADMIN_EMAIL" ]; then
    err "Could not detect your email. Set ADMIN_EMAIL env var and re-run."
    exit 1
  fi
fi

# GitHub Owner & Repo: auto-detect from git remote
if [ -z "${GITHUB_OWNER:-}" ] || [ -z "${GITHUB_REPO:-}" ]; then
  GIT_REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
  if [ -n "$GIT_REMOTE_URL" ]; then
    # Extract owner/repo from https or ssh URL
    GITHUB_SLUG=$(echo "$GIT_REMOTE_URL" | sed -E 's#.*github\.com[:/](.+)\.git$#\1#; s#.*github\.com[:/](.+)$#\1#')
    : "${GITHUB_OWNER:=$(echo "$GITHUB_SLUG" | cut -d'/' -f1 | tr '[:upper:]' '[:lower:]')}"
    : "${GITHUB_REPO:=$(echo "$GITHUB_SLUG" | cut -d'/' -f2 | tr '[:upper:]' '[:lower:]')}"
  else
    : "${GITHUB_OWNER:=bimagics}"
    : "${GITHUB_REPO:=wizbi-cp}"
  fi
fi

# Billing Account: auto-detect, only ask if multiple
if [ -z "${BILLING_ACCOUNT:-}" ]; then
  mapfile -t ACCOUNTS < <(gcloud billing accounts list --filter="open=true" --format='value(name.basename())' 2>/dev/null)
  mapfile -t ACCOUNT_NAMES < <(gcloud billing accounts list --filter="open=true" --format='value(displayName)' 2>/dev/null)
  
  if [ ${#ACCOUNTS[@]} -eq 0 ]; then
    warn "No billing accounts found."
    warn "Cloud Build and Cloud Run won't work without billing."
    echo ""
    read -rp "$(echo -e ${BOLD})Continue without billing? [Y/n]: $(echo -e ${NC})" SKIP_BILLING
    if [[ "${SKIP_BILLING:-Y}" =~ ^[Nn] ]]; then
      echo "Create one at https://console.cloud.google.com/billing/create"
      exit 1
    fi
    BILLING_ACCOUNT=""
  elif [ ${#ACCOUNTS[@]} -eq 1 ]; then
    BILLING_ACCOUNT="${ACCOUNTS[0]}"
    ok "Billing: ${ACCOUNT_NAMES[0]}"
  else
    echo -e "${BOLD}Multiple billing accounts found — pick one:${NC}"
    for i in "${!ACCOUNTS[@]}"; do
      echo "  $((i+1)). ${ACCOUNT_NAMES[$i]} (${ACCOUNTS[$i]})"
    done
    echo ""
    read -rp "$(echo -e ${BOLD})Select [1]: $(echo -e ${NC})" BILLING_CHOICE
    BILLING_CHOICE="${BILLING_CHOICE:-1}"
    BILLING_ACCOUNT="${ACCOUNTS[$((BILLING_CHOICE-1))]}"
  fi
fi

# --- Optional: GitHub App keys (can be set later via Admin Panel) ---
: "${GITHUB_APP_ID:=}"
: "${GITHUB_PRIVATE_KEY_FILE:=}"
: "${GITHUB_INSTALLATION_ID:=}"
: "${GITHUB_PAT:=}"

# --- Defaults ---
: "${AR_REPO:=wizbi}"
: "${WIF_POOL:=github-pool}"
: "${WIF_PROVIDER:=github-provider}"
: "${HOSTING_SITE:=$PROJECT_ID}"
: "${GCP_ORG_ID:=}"

# Firestore region — mapped from Cloud Run region
# App Engine requires specific region names, not multi-region codes
case "$REGION" in
  europe-west1|europe-west2|europe-west3|europe-west6)
    FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-europe-west1}"
    ;;
  us-central1|us-east1|us-east4|us-west1)
    FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-us-central1}"
    ;;
  asia-east1|asia-northeast1|asia-southeast1)
    FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-asia-east1}"
    ;;
  *)
    FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-europe-west1}"
    ;;
esac

# Derived
DEPLOYER_SA="wizbi-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
PROVISIONER_SA="wizbi-provisioner@${PROJECT_ID}.iam.gserviceaccount.com"
FACTORY_SA="wizbi-factory@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/cp-unified:latest"

echo ""
echo -e "${BOLD}Configuration Summary:${NC}"
echo "  Project ID:         $PROJECT_ID"
echo "  Region:             $REGION"
echo "  Firestore Location: $FIRESTORE_LOCATION"
echo "  Billing Account:    ${BILLING_ACCOUNT:-NONE (skipped)}"
echo "  Admin Email:        $ADMIN_EMAIL"
echo "  GitHub:             $GITHUB_OWNER/$GITHUB_REPO"
echo ""
read -rp "$(echo -e ${BOLD})Proceed? [Y/n]: $(echo -e ${NC})" CONFIRM
if [[ "${CONFIRM:-Y}" =~ ^[Nn] ]]; then
  echo "Aborted."
  exit 0
fi

# =========================================
# PHASE 1 — GCP Foundation
# =========================================
phase "Phase 1/5 — GCP Foundation"

step "Creating GCP project: $PROJECT_ID"
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  if [ -n "$GCP_ORG_ID" ]; then
    gcloud projects create "$PROJECT_ID" --organization="$GCP_ORG_ID"
  else
    gcloud projects create "$PROJECT_ID"
  fi
  ok "Project created"
else
  ok "Project already exists"
fi

if [ -n "$BILLING_ACCOUNT" ]; then
  gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  ok "Billing linked"
else
  warn "Billing skipped — link manually later: gcloud beta billing projects link $PROJECT_ID --billing-account=YOUR_ACCOUNT"
fi
gcloud config set project "$PROJECT_ID"

step "Enabling APIs"
if [ -n "$BILLING_ACCOUNT" ]; then
  echo "  Enabling all APIs (billing linked, ~60 seconds)..."
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iamcredentials.googleapis.com \
    iam.googleapis.com \
    serviceusage.googleapis.com \
    firebase.googleapis.com \
    firestore.googleapis.com \
    appengine.googleapis.com \
    storage.googleapis.com \
    identitytoolkit.googleapis.com \
    cloudresourcemanager.googleapis.com \
    cloudbilling.googleapis.com \
    firebasehosting.googleapis.com \
    apikeys.googleapis.com \
    iap.googleapis.com \
    bigquery.googleapis.com \
    --quiet
  ok "All APIs enabled"
else
  echo "  Enabling free APIs only (no billing)..."
  gcloud services enable \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    serviceusage.googleapis.com \
    firebase.googleapis.com \
    firestore.googleapis.com \
    cloudresourcemanager.googleapis.com \
    cloudbilling.googleapis.com \
    identitytoolkit.googleapis.com \
    firebasehosting.googleapis.com \
    --quiet 2>/dev/null || true
  ok "Free APIs enabled"
  warn "Paid APIs (Cloud Run, Cloud Build, Artifact Registry, Secret Manager) skipped — requires billing"
fi

step "Granting Cloud Build SA permissions"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
if [ -n "$BILLING_ACCOUNT" ]; then
  # Run sequentially — concurrent gcloud calls corrupt Cloud Shell auth state
  for ROLE in roles/storage.admin roles/artifactregistry.writer roles/artifactregistry.repoAdmin roles/logging.logWriter roles/cloudbuild.builds.builder; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$COMPUTE_SA" \
      --role="$ROLE" --quiet --no-user-output-enabled 2>/dev/null || true
  done
  ok "Cloud Build SA permissions granted"
else
  warn "Cloud Build SA permissions skipped (no billing)"
fi

if [ -n "$BILLING_ACCOUNT" ]; then
  step "Creating Artifact Registry"
  AR_CREATED=false
  for AR_ATTEMPT in $(seq 1 6); do
    if gcloud artifacts repositories describe "$AR_REPO" \
        --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
      AR_CREATED=true
      break
    fi
    echo "  Attempt $AR_ATTEMPT/6: Creating AR repository..."
    gcloud artifacts repositories create "$AR_REPO" \
      --repository-format=docker --location="$REGION" \
      --project="$PROJECT_ID" \
      --description="WIZBI containers" 2>&1 || true
    sleep 15
  done
  if [ "$AR_CREATED" = true ]; then
    ok "Artifact Registry ready"
  else
    # Final verify
    if gcloud artifacts repositories describe "$AR_REPO" \
        --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
      ok "Artifact Registry ready"
    else
      err "Artifact Registry creation failed after 6 attempts."
      err "Run: gcloud artifacts repositories create $AR_REPO --repository-format=docker --location=$REGION --project=$PROJECT_ID"
      exit 1
    fi
  fi
fi

step "Creating Firestore (Native Mode)"
# IMPORTANT: Create Firestore BEFORE App Engine!
# gcloud app create auto-creates a Datastore-mode database, which is incompatible
# with the Firebase Admin SDK's Firestore client. By creating Firestore first in
# native mode, the App Engine step won't override it.
gcloud firestore databases create \
  --location="$FIRESTORE_LOCATION" \
  --type=firestore-native \
  --project="$PROJECT_ID" 2>/dev/null || true

# Now create App Engine (if needed for the region — won't override existing DB)
gcloud app create --region="$FIRESTORE_LOCATION" --project="$PROJECT_ID" 2>/dev/null || true

# Verify the database exists and is in native mode
FS_TYPE=$(gcloud firestore databases describe --project="$PROJECT_ID" --format='value(type)' 2>/dev/null || echo "UNKNOWN")
if [ "$FS_TYPE" = "FIRESTORE_NATIVE" ]; then
  ok "Firestore ready (native mode)"
elif [ "$FS_TYPE" = "DATASTORE_MODE" ]; then
  err "Firestore is in DATASTORE_MODE — this is incompatible with the app!"
  err "Fix: delete and recreate the database:"
  err "  gcloud firestore databases delete --database='(default)' --project=$PROJECT_ID"
  err "  gcloud firestore databases create --location=$FIRESTORE_LOCATION --type=firestore-native --project=$PROJECT_ID"
  exit 1
else
  warn "Could not verify Firestore mode (got: $FS_TYPE) — proceeding"
fi

step "Creating Service Accounts"
gcloud iam service-accounts create wizbi-deployer   --display-name="WIZBI Deployer (CI/CD)" 2>/dev/null || true
gcloud iam service-accounts create wizbi-provisioner --display-name="WIZBI Provisioner (Cloud Run)" 2>/dev/null || true
gcloud iam service-accounts create wizbi-factory     --display-name="WIZBI Project Factory" 2>/dev/null || true
ok "Service Accounts created"

step "Granting IAM roles"
grant_role() {
  local sa="$1" role="$2"
  if ! gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$sa" --role="$role" --quiet --no-user-output-enabled 2>/dev/null; then
    warn "Failed to grant $role to $sa — will retry"
    sleep 5
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$sa" --role="$role" --quiet --no-user-output-enabled || warn "Retry failed for $role"
  fi
}

echo "  Granting deployer roles..."
for ROLE in roles/run.admin roles/artifactregistry.writer roles/cloudbuild.builds.editor roles/iam.serviceAccountTokenCreator roles/secretmanager.secretAccessor roles/firebasehosting.admin roles/iam.serviceAccountUser; do
  grant_role "$DEPLOYER_SA" "$ROLE"
done
echo "  Granting provisioner roles..."
for ROLE in roles/secretmanager.secretAccessor roles/secretmanager.secretVersionAdder roles/datastore.owner roles/iam.workloadIdentityPoolAdmin roles/firebase.admin roles/serviceusage.serviceUsageAdmin roles/iam.serviceAccountAdmin roles/resourcemanager.projectCreator; do
  grant_role "$PROVISIONER_SA" "$ROLE"
done
echo "  Granting factory roles..."
for ROLE in roles/resourcemanager.projectCreator roles/billing.user roles/serviceusage.serviceUsageAdmin; do
  grant_role "$FACTORY_SA" "$ROLE"
done
ok "IAM roles granted"

step "Setting up Workload Identity Federation for GitHub Actions"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud iam workload-identity-pools create "$WIF_POOL" \
  --project="$PROJECT_ID" --location="global" --display-name="GitHub Pool" 2>/dev/null || true

gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
  --project="$PROJECT_ID" --location="global" --workload-identity-pool="$WIF_POOL" \
  --display-name="GitHub Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="attribute.repository==\"${GITHUB_OWNER}/${GITHUB_REPO}\" && (attribute.ref==\"refs/heads/dev\" || attribute.ref==\"refs/heads/main\")" 2>/dev/null || true

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$WIF_POOL/attribute.repository/$GITHUB_OWNER/$GITHUB_REPO" \
  --quiet --no-user-output-enabled 2>/dev/null || true

WIF_PROVIDER_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
ok "WIF configured"

# =========================================
# BigQuery Billing Export Setup
# =========================================
step "Setting up BigQuery billing export"
BILLING_ACCOUNT_CLEAN=$(echo "$BILLING_ACCOUNT" | tr -d '-' | tr '[:upper:]' '[:lower:]')
BQ_DATASET="billing_export"
BQ_TABLE="gcp_billing_export_v1_${BILLING_ACCOUNT_CLEAN}"
BILLING_BQ_PROJECT="$PROJECT_ID"

# Create BQ dataset
if command -v bq &>/dev/null; then
  if ! bq --project_id="$PROJECT_ID" show "$BQ_DATASET" >/dev/null 2>&1; then
    # Map region to BQ location
    case "$REGION" in
      europe-*) BQ_LOCATION="EU" ;;
      us-*)     BQ_LOCATION="US" ;;
      asia-*)   BQ_LOCATION="asia-southeast1" ;;
      *)        BQ_LOCATION="EU" ;;
    esac
    bq --project_id="$PROJECT_ID" mk --dataset --location="$BQ_LOCATION" \
      --description="GCP Billing Export (auto-created by WIZBI)" "$BQ_DATASET" 2>/dev/null || true
  fi
  ok "BigQuery dataset $BQ_DATASET ready"

  # Grant billing export SA write access
  bq --project_id="$PROJECT_ID" update --dataset \
    --source <(bq --project_id="$PROJECT_ID" show --format=prettyjson "$BQ_DATASET" 2>/dev/null | python3 -c "
import sys, json
ds = json.load(sys.stdin)
access = ds.get('access', [])
sa = 'billing-export-bigquery@system.gserviceaccount.com'
if not any(a.get('userByEmail')==sa and a.get('role')=='WRITER' for a in access):
    access.append({'role':'WRITER','userByEmail':sa})
ds['access'] = access
json.dump(ds, sys.stdout)
") "$BQ_DATASET" 2>/dev/null || warn "Could not update BQ dataset permissions"

  warn "Enable billing export in Console: https://console.cloud.google.com/billing/${BILLING_ACCOUNT}/export"
  warn "Select project: $PROJECT_ID, dataset: $BQ_DATASET"
else
  warn "bq CLI not found — skipping BigQuery billing export setup"
  warn "Run tools/setup_billing_export.sh later to enable cost tracking"
fi

# =========================================
# PHASE 2 — Firebase
# =========================================
phase "Phase 2/5 — Firebase"

step "Adding Firebase to project"
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
ADD_FB_RESULT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}:addFirebase" 2>/dev/null || echo '{}')

# Extract operation name and poll until done
OP_NAME=$(echo "$ADD_FB_RESULT" | grep -o '"name": *"[^"]*"' | head -1 | sed 's/"name": *"//;s/"//')
if [ -n "$OP_NAME" ] && [ "$OP_NAME" != "null" ]; then
  echo -n "  Waiting for Firebase"
  for i in $(seq 1 30); do
    OP_RESULT=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "https://firebase.googleapis.com/v1beta1/${OP_NAME}" 2>/dev/null || echo '{}')
    echo "$OP_RESULT" | grep -q '"done": *true' && break
    echo -n "."
    sleep 5
  done
  echo ""
fi
ok "Firebase added"

step "Creating Firebase Web App"
# A Web App is needed to get the API key and appId for Firebase Auth
WEB_APP_CREATE_RESULT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps" \
  -d "{\"displayName\": \"WIZBI Control Panel\"}" 2>/dev/null || echo '{}')

# Poll for operation completion
WA_OP_NAME=$(echo "$WEB_APP_CREATE_RESULT" | grep -o '"name": *"[^"]*"' | head -1 | sed 's/"name": *"//;s/"//')
if [ -n "$WA_OP_NAME" ] && [ "$WA_OP_NAME" != "null" ]; then
  echo -n "  Creating web app"
  for WA_I in $(seq 1 12); do
    WA_OP=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "https://firebase.googleapis.com/v1beta1/${WA_OP_NAME}" 2>/dev/null || echo '{}')
    echo "$WA_OP" | grep -q '"done": *true' && break
    echo -n "."
    sleep 3
  done
  echo ""
fi

# Get the Web App ID (needed later for API key extraction)
FIREBASE_WEB_APP_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps" 2>/dev/null \
  | python3 -c "import sys,json; apps=json.load(sys.stdin).get('apps',[]); print(apps[0]['appId'] if apps else '')" 2>/dev/null || echo "")

if [ -n "$FIREBASE_WEB_APP_ID" ]; then
  ok "Web App created (appId: $FIREBASE_WEB_APP_ID)"
else
  warn "Could not detect Web App ID — API key may need manual configuration"
fi

step "Creating Hosting sites"
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJECT_ID/sites?siteId=$HOSTING_SITE" >/dev/null 2>&1 || true
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJECT_ID/sites?siteId=${HOSTING_SITE}-qa" >/dev/null 2>&1 || true
ok "Hosting sites: ${HOSTING_SITE}, ${HOSTING_SITE}-qa"

step "Configuring Firebase Authentication"
AUTH_TOKEN=$(gcloud auth print-access-token)

# Step 1: Initialize Identity Platform config
echo "  Initializing Identity Platform..."
curl -s -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d '{"signIn":{"email":{"enabled":false}}}' > /dev/null 2>&1 || true

# Step 2: Create OAuth brand (consent screen) — required before creating OAuth clients
echo "  Creating OAuth consent screen..."
BRAND_RESULT=$(curl -s -w "\n%{http_code}" -X POST \
  "https://iap.googleapis.com/v1/projects/${PROJECT_NUMBER}/brands" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"applicationTitle\": \"WIZBI Control Plane\",
    \"supportEmail\": \"${ADMIN_EMAIL}\"
  }" 2>/dev/null)
BRAND_HTTP=$(echo "$BRAND_RESULT" | tail -1)
if [ "$BRAND_HTTP" = "200" ] || [ "$BRAND_HTTP" = "409" ]; then
  echo "  OAuth consent screen ready"
fi

# Step 3: Create a real OAuth 2.0 Web Client
echo "  Creating OAuth Web Client..."
OAUTH_CLIENT_ID=""
OAUTH_CLIENT_SECRET=""

# Try creating via IAP OAuth clients API (most reliable for automation)
OAUTH_RESULT=$(curl -s -w "\n%{http_code}" -X POST \
  "https://iap.googleapis.com/v1/projects/${PROJECT_NUMBER}/brands/${PROJECT_NUMBER}/identityAwareProxyClients" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"displayName\": \"Web Client (WIZBI)\"}" 2>/dev/null)
OAUTH_HTTP=$(echo "$OAUTH_RESULT" | tail -1)
OAUTH_BODY=$(echo "$OAUTH_RESULT" | head -n -1)

if [ "$OAUTH_HTTP" = "200" ] || [ "$OAUTH_HTTP" = "201" ]; then
  # Extract the full client name (projects/123/brands/123/identityAwareProxyClients/CLIENT_ID.apps.googleusercontent.com)
  IAP_CLIENT_NAME=$(echo "$OAUTH_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
  OAUTH_CLIENT_ID=$(echo "$IAP_CLIENT_NAME" | sed 's|.*/||')
  OAUTH_CLIENT_SECRET=$(echo "$OAUTH_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret',''))" 2>/dev/null || echo "")
fi

# Fallback: Try to find existing OAuth clients (Firebase may auto-create one)
if [ -z "$OAUTH_CLIENT_ID" ]; then
  echo "  Looking for existing OAuth clients..."
  # List OAuth2 clients via the Cloud Console API
  CLIENTS_RESULT=$(curl -s \
    "https://oauth2.googleapis.com/v1/projects/${PROJECT_ID}/oauthClients" \
    -H "Authorization: Bearer $AUTH_TOKEN" 2>/dev/null || echo "{}")
  
  # Try gcloud approach
  EXISTING_CLIENT=$(gcloud alpha iap oauth-clients list "projects/${PROJECT_NUMBER}/brands/${PROJECT_NUMBER}" \
    --format='value(name)' --project="$PROJECT_ID" 2>/dev/null | head -1 || echo "")
  if [ -n "$EXISTING_CLIENT" ]; then
    OAUTH_CLIENT_ID=$(echo "$EXISTING_CLIENT" | sed 's|.*/||')
    OAUTH_CLIENT_SECRET=$(gcloud alpha iap oauth-clients describe "$EXISTING_CLIENT" \
      --format='value(secret)' --project="$PROJECT_ID" 2>/dev/null || echo "")
  fi
fi

# Step 4: Enable Google Sign-In provider with real OAuth credentials
echo "  Enabling Google Sign-In provider..."
GOOGLE_ENABLED=false

if [ -n "$OAUTH_CLIENT_ID" ] && [ -n "$OAUTH_CLIENT_SECRET" ]; then
  echo "  Using OAuth Client: ${OAUTH_CLIENT_ID:0:20}..."
  
  # Try POST first (create), then PATCH (update)
  for METHOD in POST PATCH; do
    if [ "$METHOD" = "POST" ]; then
      IDP_URL="https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs?idpId=google.com"
    else
      IDP_URL="https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com?updateMask=enabled,clientId,clientSecret"
    fi
    
    GOOGLE_IDP_RESULT=$(curl -s -w "\n%{http_code}" -X "$METHOD" "$IDP_URL" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "x-goog-user-project: ${PROJECT_ID}" \
      -H "Content-Type: application/json" \
      -d "{
        \"name\": \"projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com\",
        \"enabled\": true,
        \"clientId\": \"${OAUTH_CLIENT_ID}\",
        \"clientSecret\": \"${OAUTH_CLIENT_SECRET}\"
      }" 2>/dev/null)
    
    GOOGLE_IDP_HTTP=$(echo "$GOOGLE_IDP_RESULT" | tail -1)
    
    if [ "$GOOGLE_IDP_HTTP" = "200" ] || [ "$GOOGLE_IDP_HTTP" = "201" ]; then
      GOOGLE_ENABLED=true
      break
    fi
  done
fi

if [ "$GOOGLE_ENABLED" = "true" ]; then
  ok "Google Sign-In enabled automatically"
else
  echo ""
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  warn "ACTION REQUIRED: Enable Google Sign-In manually (30 seconds):"
  warn "  1. Open: https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
  warn "  2. Click 'Google' → Enable → Save"
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  read -rp "$(echo -e ${BOLD})Press Enter once Google Sign-In is enabled (or 's' to skip): $(echo -e ${NC})" AUTH_SKIP
  if [[ "$AUTH_SKIP" != "s" ]]; then
    ok "Proceeding (Google Sign-In should be enabled now)"
  else
    warn "Skipped — enable Google Sign-In later in Firebase Console"
  fi
fi

# Step 3: Set authorized domains for Firebase Auth
echo "  Setting authorized domains..."
curl -s -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d "{
    \"authorizedDomains\": [
      \"localhost\",
      \"${HOSTING_SITE}.firebaseapp.com\",
      \"${HOSTING_SITE}.web.app\",
      \"${HOSTING_SITE}-qa.firebaseapp.com\",
      \"${HOSTING_SITE}-qa.web.app\"
    ]
  }" > /dev/null 2>&1 || true

ok "Firebase Auth configured"

# =========================================
# PHASE 3 — Secrets (requires billing for Secret Manager)
# =========================================
if [ -n "$BILLING_ACCOUNT" ]; then
phase "Phase 3/5 — Secrets"

# Helper function
upsert_secret() {
  local NAME="$1"; local VALUE="$2"
  if gcloud secrets describe "$NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "$VALUE" | gcloud secrets versions add "$NAME" --data-file=- --project="$PROJECT_ID" >/dev/null
  else
    echo "$VALUE" | gcloud secrets create "$NAME" --data-file=- --project="$PROJECT_ID" >/dev/null
  fi
}

step "Creating secrets in Secret Manager"

# GitHub App secrets (real values if provided, placeholder otherwise)
if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_PRIVATE_KEY_FILE" ] && [ -f "$GITHUB_PRIVATE_KEY_FILE" ] && [ -n "$GITHUB_INSTALLATION_ID" ]; then
  upsert_secret "GITHUB_APP_ID" "$GITHUB_APP_ID"
  upsert_secret "GITHUB_PRIVATE_KEY" "$(cat "$GITHUB_PRIVATE_KEY_FILE")"
  upsert_secret "GITHUB_INSTALLATION_ID" "$GITHUB_INSTALLATION_ID"
  ok "GitHub App secrets stored (real values)"
else
  upsert_secret "GITHUB_APP_ID" "placeholder"
  upsert_secret "GITHUB_PRIVATE_KEY" "placeholder"
  upsert_secret "GITHUB_INSTALLATION_ID" "placeholder"
  warn "GitHub App secrets set as placeholders — configure later in Admin Panel → Settings"
fi

ok "All secrets created"
else
  phase "Phase 3/5 — Secrets (SKIPPED)"
  warn "Secret Manager requires billing — skipping secrets creation"
fi

# =========================================
# PHASE 4 — Build & Deploy (requires billing)
# =========================================
if [ -n "$BILLING_ACCOUNT" ]; then
phase "Phase 4/5 — Build & Deploy"

# Ensure firebase-tools is available
step "Installing Firebase CLI"
if ! command -v firebase >/dev/null 2>&1; then
  npm install -g firebase-tools --quiet 2>/dev/null || true
fi
ok "Firebase CLI ready"

step "Building & pushing container image (Cloud Build, ~2 min)"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet 2>/dev/null || true

# --- Cloud Build GCS Staging Bucket ---
# Cloud Build uploads source to gs://{PROJECT_ID}_cloudbuild before building.
# Project-level IAM (roles/storage.admin) can take 7+ min to propagate.
# Fix: explicitly create the bucket + grant bucket-level IAM (instant propagation).
CB_BUCKET="${PROJECT_ID}_cloudbuild"
echo "  Creating Cloud Build staging bucket: gs://${CB_BUCKET}"
gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${CB_BUCKET}" 2>/dev/null || true

# Grant bucket-level storage admin to the Compute SA (propagates instantly)
echo "  Granting bucket-level storage access to Cloud Build SA..."
gsutil iam ch "serviceAccount:${COMPUTE_SA}:roles/storage.objectAdmin" "gs://${CB_BUCKET}" 2>/dev/null || true
gsutil iam ch "serviceAccount:${COMPUTE_SA}:roles/storage.legacyBucketReader" "gs://${CB_BUCKET}" 2>/dev/null || true

# Also create the AR Docker repo bucket (used for pushing images)
AR_BUCKET="artifacts.${PROJECT_ID}.appspot.com"
gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${AR_BUCKET}" 2>/dev/null || true
gsutil iam ch "serviceAccount:${COMPUTE_SA}:roles/storage.objectAdmin" "gs://${AR_BUCKET}" 2>/dev/null || true

# Grant repository-level Artifact Registry writer to the Compute SA
# Project-level IAM for AR can take 7+ min to propagate, but repo-level propagates instantly.
echo "  Granting repository-level Artifact Registry write access..."
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --location="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.writer" --quiet --no-user-output-enabled 2>/dev/null || true
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --location="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.repoAdmin" --quiet --no-user-output-enabled 2>/dev/null || true

# Brief wait for bucket-level IAM (much faster than project-level)
echo "  Waiting for IAM propagation (30s)..."
sleep 30

# Verify GCS access is working before attempting build
step "Verifying Cloud Build storage access"
for VERIFY_I in $(seq 1 4); do
  if gsutil ls "gs://${CB_BUCKET}" >/dev/null 2>&1; then
    ok "Cloud Build storage access confirmed"
    break
  fi
  if [ "$VERIFY_I" -eq 4 ]; then
    warn "Could not verify GCS access after 2 minutes. Proceeding anyway..."
    break
  fi
  echo "  Storage not ready yet, waiting 30s... ($VERIFY_I/4)"
  sleep 30
done

step "Submitting Cloud Build (~2 min)"
MAX_RETRIES=3
for i in $(seq 1 $MAX_RETRIES); do
  echo "  Attempt $i/$MAX_RETRIES: Submitting build..."
  if gcloud builds submit . \
      --tag="$IMAGE_TAG" \
      --project="$PROJECT_ID" \
      --gcs-source-staging-dir="gs://${CB_BUCKET}/source" \
      --quiet; then
    ok "Image built & pushed: $IMAGE_TAG"
    break
  else
    if [ "$i" -eq "$MAX_RETRIES" ]; then
      err "Build failed after $MAX_RETRIES attempts. Check Cloud Build logs in GCP Console."
      err "Common fix: wait 2 minutes and re-run this script with PROJECT_ID=$PROJECT_ID"
      exit 1
    fi
    warn "Build failed. Retrying in 60s..."
    sleep 60
  fi
done

# Build env vars for Cloud Run
# Fetch Firebase Web API key from the Web App config (most reliable method)
step "Fetching Firebase API key"
FIREBASE_API_KEY=""

# Method 1: Use the Web App config endpoint (returns the actual key string)
if [ -n "$FIREBASE_WEB_APP_ID" ]; then
  FIREBASE_API_KEY=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${FIREBASE_WEB_APP_ID}/config" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiKey',''))" 2>/dev/null || echo "")
fi

# Method 2: Fallback — search API keys list for any key
if [ -z "$FIREBASE_API_KEY" ]; then
  echo "  Web App config didn't return API key, trying API keys list..."
  # Get the first API key's resource name
  API_KEY_RESOURCE=$(gcloud services api-keys list --project="$PROJECT_ID" \
    --format='value(name)' 2>/dev/null | head -1 || echo "")
  if [ -n "$API_KEY_RESOURCE" ]; then
    FIREBASE_API_KEY=$(gcloud services api-keys get-key-string "$API_KEY_RESOURCE" \
      --project="$PROJECT_ID" --format='value(keyString)' 2>/dev/null || echo "")
  fi
fi

if [ -n "$FIREBASE_API_KEY" ]; then
  ok "Firebase API key: ${FIREBASE_API_KEY:0:10}..."
else
  warn "Could not retrieve Firebase API key — login on Cloud Run direct URL won't work (Firebase Hosting login will still work)"
fi

CORS_ORIGINS="https://${HOSTING_SITE}.web.app,https://${HOSTING_SITE}-qa.web.app,https://${HOSTING_SITE}.firebaseapp.com,https://${HOSTING_SITE}-qa.firebaseapp.com"

step "Deploying Cloud Run: cp-unified (Production)"
gcloud run deploy "cp-unified" \
  --image "$IMAGE_TAG" \
  --region "$REGION" \
  --service-account "$PROVISIONER_SA" \
  --allow-unauthenticated \
  --update-env-vars "^~^NODE_ENV=production~FIREBASE_PROJECT_ID=$PROJECT_ID~GCP_PROJECT_ID=$PROJECT_ID~BILLING_ACCOUNT_ID=$BILLING_ACCOUNT~CORS_ORIGIN=$CORS_ORIGINS~ADMINS=$ADMIN_EMAIL~GCP_CONTROL_PLANE_PROJECT_NUMBER=$PROJECT_NUMBER~GITHUB_OWNER=$GITHUB_OWNER${FIREBASE_API_KEY:+~FIREBASE_API_KEY=$FIREBASE_API_KEY}~BILLING_BQ_PROJECT=${BILLING_BQ_PROJECT:-$PROJECT_ID}~BILLING_BQ_DATASET=${BQ_DATASET:-billing_export}~BILLING_BQ_TABLE=${BQ_TABLE:-}" \
  --quiet
ok "Production service deployed"

# Verify Cloud Run is responding
PROD_RUN_URL=$(gcloud run services describe cp-unified --region="$REGION" --format='value(status.url)' 2>/dev/null || echo "")
if [ -n "$PROD_RUN_URL" ]; then
  echo "  Verifying deployment at $PROD_RUN_URL/healthz ..."
  for HC_I in $(seq 1 5); do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_RUN_URL/healthz" 2>/dev/null || echo "000")
    if [ "$HTTP_STATUS" = "200" ]; then
      ok "Cloud Run is healthy (HTTP 200)"
      break
    fi
    [ "$HC_I" -eq 5 ] && warn "Health check didn't return 200 (got $HTTP_STATUS) — service may need time to start"
    sleep 10
  done
fi

step "Deploying Cloud Run: cp-unified-qa (QA)"
gcloud run deploy "cp-unified-qa" \
  --image "$IMAGE_TAG" \
  --region "$REGION" \
  --service-account "$PROVISIONER_SA" \
  --allow-unauthenticated \
  --update-env-vars "^~^NODE_ENV=production~FIREBASE_PROJECT_ID=$PROJECT_ID~GCP_PROJECT_ID=$PROJECT_ID~BILLING_ACCOUNT_ID=$BILLING_ACCOUNT~CORS_ORIGIN=$CORS_ORIGINS~ADMINS=$ADMIN_EMAIL~GCP_CONTROL_PLANE_PROJECT_NUMBER=$PROJECT_NUMBER~GITHUB_OWNER=$GITHUB_OWNER${FIREBASE_API_KEY:+~FIREBASE_API_KEY=$FIREBASE_API_KEY}~BILLING_BQ_PROJECT=${BILLING_BQ_PROJECT:-$PROJECT_ID}~BILLING_BQ_DATASET=${BQ_DATASET:-billing_export}~BILLING_BQ_TABLE=${BQ_TABLE:-}" \
  --quiet
ok "QA service deployed"

step "Updating firebase.json to match region"
# Dynamically patch firebase.json to use the correct region and service names
cat > firebase.json <<FIREBASE_EOF
{
  "hosting": [
    {
      "target": "production",
      "public": "public",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "headers": [
        {
          "source": "/admin/**",
          "headers": [
            { "key": "Cache-Control", "value": "no-store" },
            { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" }
          ]
        }
      ],
      "redirects": [
        { "source": "/", "destination": "/admin/", "type": 302 }
      ],
      "rewrites": [
        { "source": "/admin/**", "destination": "/admin/index.html" },
        { "source": "/api/**", "run": { "serviceId": "cp-unified", "region": "${REGION}" } }
      ]
    },
    {
      "target": "qa",
      "public": "public",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "headers": [
        {
          "source": "/admin/**",
          "headers": [
            { "key": "Cache-Control", "value": "no-store" },
            { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" }
          ]
        }
      ],
      "redirects": [
        { "source": "/", "destination": "/admin/", "type": 302 }
      ],
      "rewrites": [
        { "source": "/admin/**", "destination": "/admin/index.html" },
        { "source": "/api/**", "run": { "serviceId": "cp-unified-qa", "region": "${REGION}" } }
      ]
    }
  ]
}
FIREBASE_EOF
ok "firebase.json updated with region: $REGION"

step "Deploying Firebase Hosting"
# Ensure Firebase CLI is authenticated
export FIREBASE_CLI_EXPERIMENTS=webframeworks 2>/dev/null || true

# Test Firebase auth — if it fails, prompt for login
if ! firebase projects:list 2>/dev/null | grep -q "$PROJECT_ID"; then
  echo "  Firebase CLI needs authentication..."
  firebase login --no-localhost
fi

# Map Firebase targets to actual hosting sites
firebase target:apply hosting production "${HOSTING_SITE}" --project "$PROJECT_ID" 2>/dev/null || true
firebase target:apply hosting qa "${HOSTING_SITE}-qa" --project "$PROJECT_ID" 2>/dev/null || true

firebase deploy \
  --only hosting:production \
  --project "$PROJECT_ID" \
  --non-interactive 2>/dev/null || warn "Production hosting deploy failed — will deploy on first git push"

firebase deploy \
  --only hosting:qa \
  --project "$PROJECT_ID" \
  --non-interactive 2>/dev/null || warn "QA hosting deploy failed — will deploy on first git push"

ok "Hosting deployed"

else
  phase "Phase 4/5 — Build & Deploy (SKIPPED)"
  warn "Cloud Build, Cloud Run, and Firebase Hosting deploy require billing."
  warn "Link billing, then re-run this script to complete deployment."
fi

# =========================================
# PHASE 5 — GitHub Secrets (if PAT provided)
# =========================================
phase "Phase 5/5 — CI/CD Setup"

if [ -n "$GITHUB_PAT" ]; then
  step "Injecting GitHub Actions secrets"

  # Get repo public key for encryption
  REPO_KEY_RESPONSE=$(curl -s -H "Authorization: token $GITHUB_PAT" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/secrets/public-key")

  REPO_KEY_ID=$(echo "$REPO_KEY_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('key_id',''))" 2>/dev/null || echo "")
  REPO_PUBLIC_KEY=$(echo "$REPO_KEY_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")

  if [ -n "$REPO_KEY_ID" ] && [ -n "$REPO_PUBLIC_KEY" ]; then
    # Install pynacl if not present
    pip3 install pynacl --quiet 2>/dev/null || true

    set_github_secret() {
      local S_NAME="$1"; local S_VALUE="$2"
      # Use a temp file to safely pass values with special characters
      local TMPVAL=$(mktemp)
      echo -n "$S_VALUE" > "$TMPVAL"
      ENCRYPTED=$(python3 -c "
import base64, sys
from nacl import encoding, public
pk = public.PublicKey('${REPO_PUBLIC_KEY}'.encode('utf-8'), encoding.Base64Encoder())
with open('${TMPVAL}', 'r') as f:
    val = f.read()
sealed = public.SealedBox(pk).encrypt(val.encode('utf-8'))
print(base64.b64encode(sealed).decode('utf-8'))
" 2>/dev/null || echo "")
      rm -f "$TMPVAL"
      if [ -n "$ENCRYPTED" ]; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
          -H "Authorization: token $GITHUB_PAT" \
          -H "Accept: application/vnd.github.v3+json" \
          "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/secrets/${S_NAME}" \
          -d "{\"encrypted_value\":\"$ENCRYPTED\",\"key_id\":\"$REPO_KEY_ID\"}")
        [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ] && ok "  $S_NAME" || warn "  $S_NAME (HTTP $HTTP_CODE)"
      else
        warn "  $S_NAME — encryption failed"
      fi
    }

    set_github_secret "GCP_PROJECT_ID" "$PROJECT_ID"
    set_github_secret "GCP_REGION" "$REGION"
    set_github_secret "WIF_PROVIDER" "$WIF_PROVIDER_PATH"
    set_github_secret "DEPLOYER_SA" "$DEPLOYER_SA"
    set_github_secret "GCP_CONTROL_PLANE_PROJECT_NUMBER" "$PROJECT_NUMBER"
    set_github_secret "BILLING_ACCOUNT_ID" "$BILLING_ACCOUNT"
    set_github_secret "BILLING_BQ_PROJECT" "${BILLING_BQ_PROJECT:-$PROJECT_ID}"
    set_github_secret "BILLING_BQ_DATASET" "${BQ_DATASET:-billing_export}"
    set_github_secret "BILLING_BQ_TABLE" "${BQ_TABLE:-}"
    set_github_secret "ADMINS" "$ADMIN_EMAIL"
    if [ -n "$FIREBASE_API_KEY" ]; then
      set_github_secret "FIREBASE_API_KEY" "$FIREBASE_API_KEY"
    fi
    ok "GitHub secrets injected"
  else
    warn "Could not fetch GitHub repo public key — set secrets manually"
  fi
else
  warn "GITHUB_PAT not provided — skipping automatic GitHub secrets injection"
  echo ""
  echo -e "${BOLD}Set these GitHub Actions secrets manually:${NC}"
  echo "  GCP_PROJECT_ID                   = $PROJECT_ID"
  echo "  GCP_REGION                       = $REGION"
  echo "  WIF_PROVIDER                     = $WIF_PROVIDER_PATH"
  echo "  DEPLOYER_SA                      = $DEPLOYER_SA"
  echo "  GCP_CONTROL_PLANE_PROJECT_NUMBER = $PROJECT_NUMBER"
  echo "  BILLING_ACCOUNT_ID               = $BILLING_ACCOUNT"
  echo "  BILLING_BQ_PROJECT               = ${BILLING_BQ_PROJECT:-$PROJECT_ID}"
  echo "  BILLING_BQ_DATASET               = ${BQ_DATASET:-billing_export}"
  echo "  BILLING_BQ_TABLE                 = ${BQ_TABLE:-<run setup_billing_export.sh>}"
  echo "  ADMINS                           = $ADMIN_EMAIL"
  echo "  FIREBASE_API_KEY                 = ${FIREBASE_API_KEY:-<not available>}"
fi

# =========================================
# DONE — Summary
# =========================================
PROD_URL="https://${HOSTING_SITE}.web.app"
QA_URL="https://${HOSTING_SITE}-qa.web.app"
CLOUD_RUN_URL=$(gcloud run services describe cp-unified --region="$REGION" --format='value(status.url)' 2>/dev/null || echo "N/A")

echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         ✅  WIZBI Control Plane — Setup Complete!          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ -n "$BILLING_ACCOUNT" ]; then
  echo -e "${BOLD}Your Admin Panel:${NC}  ${PROD_URL}/admin/"
  echo -e "${BOLD}QA Admin Panel:${NC}   ${QA_URL}/admin/"
  echo -e "${BOLD}Cloud Run API:${NC}    ${CLOUD_RUN_URL}"
  echo ""
  echo -e "${BOLD}Next Steps:${NC}"
  echo "  1. Open ${PROD_URL}/admin/"
  echo "  2. Log in with ${ADMIN_EMAIL}"
  echo "  3. Go to Settings → click 'Connect GitHub App' (2 clicks!)"
  echo "  4. Create templates and start provisioning projects!"
else
  echo -e "${BOLD}Project Created:${NC}  $PROJECT_ID"
  echo -e "${BOLD}Status:${NC}           Foundation ready (billing required to deploy)"
  echo ""
  echo -e "${BOLD}Next Steps:${NC}"
  echo "  1. Link a billing account:"
  echo "     gcloud beta billing projects link $PROJECT_ID --billing-account=YOUR_ACCOUNT_ID"
  echo "  2. Re-run this script to complete deployment:"
  echo "     BILLING_ACCOUNT=YOUR_ACCOUNT_ID PROJECT_ID=$PROJECT_ID ./tools/bootstrap_full.sh"
fi
echo ""
echo -e "${BOLD}CI/CD:${NC}"
echo "  Push to 'dev' branch  → deploys to QA"
echo "  Push to 'main' branch → deploys to Production"
echo ""
echo -e "${GREEN}${BOLD}Done! 🚀${NC}"

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
# PHASE 0 — Interactive Input
# =========================================
phase "WIZBI Control Plane — Setup Wizard"

echo -e "${BOLD}Welcome! This script will set up your WIZBI Control Plane on GCP.${NC}"
echo -e "You'll need a GCP Billing Account. Everything else is automatic.\n"

# --- Project ID (auto-generate unique suffix) ---
RANDOM_SUFFIX=$(head -c 100 /dev/urandom | tr -dc 'a-z0-9' | head -c 4)
DEFAULT_PROJECT_ID="wizbi-cp-${RANDOM_SUFFIX}"
if [ -z "${PROJECT_ID:-}" ]; then
  read -rp "$(echo -e ${BOLD})Enter Project ID [${DEFAULT_PROJECT_ID}]: $(echo -e ${NC})" PROJECT_ID
  PROJECT_ID="${PROJECT_ID:-$DEFAULT_PROJECT_ID}"
fi

# --- Region ---
if [ -z "${REGION:-}" ]; then
  REGION="europe-west1"
fi

# --- Billing Account ---
if [ -z "${BILLING_ACCOUNT:-}" ]; then
  echo ""
  echo -e "${BOLD}Available Billing Accounts:${NC}"
  # Store accounts in array for numbered selection
  mapfile -t ACCOUNTS < <(gcloud billing accounts list --filter="open=true" --format='value(name.basename())' 2>/dev/null)
  mapfile -t ACCOUNT_NAMES < <(gcloud billing accounts list --filter="open=true" --format='value(displayName)' 2>/dev/null)
  
  if [ ${#ACCOUNTS[@]} -eq 0 ]; then
    err "No open billing accounts found."
    exit 1
  elif [ ${#ACCOUNTS[@]} -eq 1 ]; then
    BILLING_ACCOUNT="${ACCOUNTS[0]}"
    echo "  Using: ${ACCOUNT_NAMES[0]} (${BILLING_ACCOUNT})"
  else
    for i in "${!ACCOUNTS[@]}"; do
      echo "  $((i+1)). ${ACCOUNT_NAMES[$i]} (${ACCOUNTS[$i]})"
    done
    echo ""
    read -rp "$(echo -e ${BOLD})Select billing account [1]: $(echo -e ${NC})" BILLING_CHOICE
    BILLING_CHOICE="${BILLING_CHOICE:-1}"
    BILLING_ACCOUNT="${ACCOUNTS[$((BILLING_CHOICE-1))]}"
  fi
  echo ""
fi

# --- Admin Email ---
if [ -z "${ADMIN_EMAIL:-}" ]; then
  DETECTED_EMAIL=$(gcloud config get-value account 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "")
  if [ -n "$DETECTED_EMAIL" ]; then
    read -rp "$(echo -e ${BOLD})Admin email [$DETECTED_EMAIL]: $(echo -e ${NC})" ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-$DETECTED_EMAIL}"
  else
    read -rp "$(echo -e ${BOLD})Enter Admin email: $(echo -e ${NC})" ADMIN_EMAIL
  fi
fi
ADMIN_EMAIL=$(echo "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')

# --- GitHub Owner (for CI/CD) ---
if [ -z "${GITHUB_OWNER:-}" ]; then
  read -rp "$(echo -e ${BOLD})GitHub Org or User that owns this repo [bimagics]: $(echo -e ${NC})" GITHUB_OWNER
  GITHUB_OWNER="${GITHUB_OWNER:-bimagics}"
fi
GITHUB_OWNER=$(echo "$GITHUB_OWNER" | tr '[:upper:]' '[:lower:]')

# --- GitHub Repo ---
: "${GITHUB_REPO:=wizbi-cp}"

# --- Optional: GitHub App keys (can be set later via Admin Panel) ---
: "${GITHUB_APP_ID:=}"
: "${GITHUB_PRIVATE_KEY_FILE:=}"
: "${GITHUB_INSTALLATION_ID:=}"
: "${GITHUB_PAT:=}"

# --- Defaults ---
: "${FIRESTORE_LOCATION:=eur3}"
: "${AR_REPO:=wizbi}"
: "${WIF_POOL:=github-pool}"
: "${WIF_PROVIDER:=github-provider}"
: "${HOSTING_SITE:=$PROJECT_ID}"
: "${GCP_ORG_ID:=}"

# Derived
DEPLOYER_SA="wizbi-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
PROVISIONER_SA="wizbi-provisioner@${PROJECT_ID}.iam.gserviceaccount.com"
FACTORY_SA="wizbi-factory@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/cp-unified:latest"

echo ""
echo -e "${BOLD}Configuration Summary:${NC}"
echo "  Project ID:      $PROJECT_ID"
echo "  Region:          $REGION"
echo "  Billing Account: $BILLING_ACCOUNT"
echo "  Admin Email:     $ADMIN_EMAIL"
echo "  GitHub:          $GITHUB_OWNER/$GITHUB_REPO"
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

gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"
ok "Billing linked"

step "Enabling APIs (this takes ~60 seconds)"
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
  --quiet
ok "All APIs enabled"

step "Granting Cloud Build SA storage access"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CB_SA" \
  --role="roles/storage.admin" --quiet --no-user-output-enabled 2>/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$COMPUTE_SA" \
  --role="roles/storage.admin" --quiet --no-user-output-enabled 2>/dev/null || true
ok "Cloud Build storage access granted"

step "Creating Artifact Registry"
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="WIZBI containers" 2>/dev/null || true
ok "Artifact Registry ready"

step "Creating Firestore (Native Mode)"
gcloud app create --region="$FIRESTORE_LOCATION" 2>/dev/null || true
gcloud firestore databases create --region="$FIRESTORE_LOCATION" --type=firestore-native 2>/dev/null || true
ok "Firestore ready"

step "Creating Service Accounts"
gcloud iam service-accounts create wizbi-deployer   --display-name="WIZBI Deployer (CI/CD)" 2>/dev/null || true
gcloud iam service-accounts create wizbi-provisioner --display-name="WIZBI Provisioner (Cloud Run)" 2>/dev/null || true
gcloud iam service-accounts create wizbi-factory     --display-name="WIZBI Project Factory" 2>/dev/null || true
ok "Service Accounts created"

step "Granting IAM roles"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/cloudbuild.builds.editor roles/iam.serviceAccountTokenCreator roles/secretmanager.secretAccessor roles/firebasehosting.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER_SA" --role="$ROLE" --quiet --no-user-output-enabled 2>/dev/null || true
done
for ROLE in roles/secretmanager.secretAccessor roles/secretmanager.secretVersionAdder roles/datastore.user roles/iam.workloadIdentityPoolAdmin roles/firebase.admin roles/serviceusage.serviceUsageAdmin roles/iam.serviceAccountAdmin roles/resourcemanager.projectCreator; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$PROVISIONER_SA" --role="$ROLE" --quiet --no-user-output-enabled 2>/dev/null || true
done
for ROLE in roles/resourcemanager.projectCreator roles/billing.user roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$FACTORY_SA" --role="$ROLE" --quiet --no-user-output-enabled 2>/dev/null || true
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
# PHASE 2 — Firebase
# =========================================
phase "Phase 2/5 — Firebase"

step "Installing Firebase CLI"
if ! command -v firebase >/dev/null 2>&1; then
  npm install -g firebase-tools >/dev/null 2>&1 || true
fi

step "Adding Firebase to project"
# Use REST API directly — Firebase CLI auth is broken in Cloud Shell
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}:addFirebase" 2>/dev/null || true
ok "Firebase added"

step "Creating Hosting sites"
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJECT_ID/sites?siteId=$HOSTING_SITE" 2>/dev/null || true
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJECT_ID/sites?siteId=${HOSTING_SITE}-qa" 2>/dev/null || true
ok "Hosting sites: ${HOSTING_SITE}, ${HOSTING_SITE}-qa"

# =========================================
# PHASE 3 — Secrets
# =========================================
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

# =========================================
# PHASE 4 — Build & Deploy
# =========================================
phase "Phase 4/5 — Build & Deploy"

step "Building container image (this takes ~2-3 minutes)"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet 2>/dev/null || true

# Use Cloud Build (always available in Cloud Shell)
gcloud builds submit . \
  --tag="$IMAGE_TAG" \
  --project="$PROJECT_ID" \
  --quiet
ok "Image built: $IMAGE_TAG"

# Build env vars for Cloud Run
CLOUD_RUN_ENV="NODE_ENV=production"
CLOUD_RUN_ENV+=",FIREBASE_PROJECT_ID=$PROJECT_ID"
CLOUD_RUN_ENV+=",GCP_PROJECT_ID=$PROJECT_ID"
CLOUD_RUN_ENV+=",BILLING_ACCOUNT_ID=$BILLING_ACCOUNT"
CLOUD_RUN_ENV+=",CORS_ORIGIN=*"
CLOUD_RUN_ENV+=",ADMINS=$ADMIN_EMAIL"
CLOUD_RUN_ENV+=",GCP_CONTROL_PLANE_PROJECT_NUMBER=$PROJECT_NUMBER"
CLOUD_RUN_ENV+=",GITHUB_OWNER=$GITHUB_OWNER"

step "Deploying Cloud Run: cp-unified (Production)"
gcloud run deploy "cp-unified" \
  --image "$IMAGE_TAG" \
  --region "$REGION" \
  --service-account "$PROVISIONER_SA" \
  --allow-unauthenticated \
  --update-env-vars "$CLOUD_RUN_ENV" \
  --quiet
ok "Production service deployed"

step "Deploying Cloud Run: cp-unified-qa (QA)"
gcloud run deploy "cp-unified-qa" \
  --image "$IMAGE_TAG" \
  --region "$REGION" \
  --service-account "$PROVISIONER_SA" \
  --allow-unauthenticated \
  --update-env-vars "$CLOUD_RUN_ENV" \
  --quiet
ok "QA service deployed"

step "Deploying Firebase Hosting"
firebase deploy \
  --only "hosting:${HOSTING_SITE}" \
  --project "$PROJECT_ID" \
  --non-interactive 2>/dev/null || warn "Production hosting deploy failed — will deploy on first git push"

firebase deploy \
  --only "hosting:${HOSTING_SITE}-qa" \
  --project "$PROJECT_ID" \
  --non-interactive 2>/dev/null || warn "QA hosting deploy failed — will deploy on first git push"

ok "Hosting deployed"

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
      ENCRYPTED=$(python3 -c "
import base64
from nacl import encoding, public
pk = public.PublicKey('$REPO_PUBLIC_KEY'.encode('utf-8'), encoding.Base64Encoder())
sealed = public.SealedBox(pk).encrypt('$S_VALUE'.encode('utf-8'))
print(base64.b64encode(sealed).decode('utf-8'))
" 2>/dev/null || echo "")
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
echo -e "${BOLD}Your Admin Panel:${NC}  ${PROD_URL}/admin/"
echo -e "${BOLD}QA Admin Panel:${NC}   ${QA_URL}/admin/"
echo -e "${BOLD}Cloud Run API:${NC}    ${CLOUD_RUN_URL}"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "  1. Open ${PROD_URL}/admin/"
echo "  2. Log in with ${ADMIN_EMAIL}"
echo "  3. Go to Settings → configure your GitHub App keys"
echo "  4. Start provisioning projects!"
echo ""
echo -e "${BOLD}CI/CD:${NC}"
echo "  Push to 'dev' branch  → deploys to QA"
echo "  Push to 'main' branch → deploys to Production"
echo ""
echo -e "${GREEN}${BOLD}Done! 🚀${NC}"

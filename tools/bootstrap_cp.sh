# --- REPLACE THE ENTIRE FILE CONTENT ---
# File: tools/bootstrap_cp.sh

#!/usr/bin/env bash
set -euo pipefail

# Required env vars (fill before running)
: "${PROJECT_ID:?Must set PROJECT_ID}"
: "${REGION:=europe-west1}"
: "${FIRESTORE_LOCATION:=eur3}"
: "${AR_REPO:=wizbi}"
: "${BILLING_ACCOUNT:?Must set BILLING_ACCOUNT}"
: "${GITHUB_OWNER:?Must set GITHUB_OWNER}"
: "${GITHUB_REPO:?Must set GITHUB_REPO}"
: "${WIF_POOL:=github-pool}"
: "${WIF_PROVIDER:=github-provider}"
: "${HOSTING_SITE:=wizbi-cp}"

echo ">>> Config:"
echo "PROJECT_ID=$PROJECT_ID REGION=$REGION FIRESTORE_LOCATION=$FIRESTORE_LOCATION AR_REPO=$AR_REPO"
echo "GITHUB_OWNER=$GITHUB_OWNER GITHUB_REPO=$GITHUB_REPO WIF_POOL=$WIF_POOL WIF_PROVIDER=$WIF_PROVIDER"
echo "HOSTING_SITE=$HOSTING_SITE BILLING=$BILLING_ACCOUNT"

echo ">>> Creating/setting project & billing"
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT_ID"
fi
gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"

echo ">>> Enabling core APIs"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com iam.googleapis.com \
  serviceusage.googleapis.com firebase.googleapis.com firestore.googleapis.com \
  appengine.googleapis.com storage.googleapis.com identitytoolkit.googleapis.com \
  --quiet

echo ">>> Artifact Registry: $AR_REPO"
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="WIZBI containers" || true

echo ">>> App Engine + Firestore (Native)"
gcloud app create --region="$FIRESTORE_LOCATION" || true
gcloud firestore databases create --region="$FIRESTORE_LOCATION" --type=firestore-native || true

echo ">>> Service Accounts"
gcloud iam service-accounts create wizbi-deployer --display-name="WIZBI Deployer" || true
gcloud iam service-accounts create wizbi-runner   --display-name="WIZBI Runner"   || true
gcloud iam service-accounts create wizbi-factory  --display-name="WIZBI Project Factory" || true

DEPLOYER_SA="wizbi-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNNER_SA="wizbi-runner@${PROJECT_ID}.iam.gserviceaccount.com"
FACTORY_SA="wizbi-factory@${PROJECT_ID}.iam.gserviceaccount.com"

echo ">>> Grant minimal roles to Deployer SA"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/cloudbuild.builds.editor roles/iam.serviceAccountTokenCreator roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER_SA" --role="$ROLE" --quiet || true
done

echo ">>> Grant minimal roles to Runner SA"
# MODIFICATION: Added roles/iam.workloadIdentityPoolAdmin and roles/firebase.admin to the runner SA
# This allows the control plane to manage WIF providers in the central pool and manage firebase projects.
# The other necessary permissions (projectCreator, billing.user etc) must be granted manually on the parent folder/org.
for ROLE in roles/secretmanager.secretAccessor roles/datastore.user roles/iam.workloadIdentityPoolAdmin roles/firebase.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNNER_SA" --role="$ROLE" --quiet || true
done

echo ">>> Grant factory roles (for later org provisioning)"
# NOTE: To allow project creation, the RUNNER_SA (not factory) needs these roles on the parent Folder/Organization.
# This must be done manually after the bootstrap script runs.
for ROLE in roles/resourcemanager.projectCreator roles/billing.user roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$FACTORY_SA" --role="$ROLE" --quiet || true
done

echo ">>> Workload Identity Federation (GitHub)"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam workload-identity-pools create "$WIF_POOL" \
  --project="$PROJECT_ID" --location="global" --display-name="GitHub Pool" || true

gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
  --project="$PROJECT_ID" --location="global" --workload-identity-pool="$WIF_POOL" \
  --display-name="GitHub Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="attribute.repository==\"$GITHUB_OWNER/$GITHUB_REPO\" && (attribute.ref==\"refs/heads/dev\" || attribute.ref==\"refs/heads/main\")" || true

echo ">>> Bind WIF to Deployer SA"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$WIF_POOL/attribute.repository/$GITHUB_OWNER/$GITHUB_REPO" \
  --quiet || true

WIF_PROVIDER_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
echo "WIF_PROVIDER=${WIF_PROVIDER_PATH}"
echo "GCP_CONTROL_PLANE_PROJECT_NUMBER=${PROJECT_NUMBER}"

echo ">>> (Optional) Firebase setup — requires firebase-tools login"
if ! command -v firebase >/dev/null 2>&1; then
  npm -g install firebase-tools >/dev/null 2>&1 || true
fi

set +e
firebase projects:addfirebase "$PROJECT_ID"
FIREBASE_OK=$?
set -e
if [ "$FIREBASE_OK" -eq 0 ]; then
  echo "Firebase linked."
  firebase hosting:sites:create "$HOSTING_SITE" --project "$PROJECT_ID" || true
  firebase hosting:channel:create qa --project "$PROJECT_ID" --site "$HOSTING_SITE" || true
else
  echo "Skipping Firebase actions (login required). You can run later:\n  firebase login\n  firebase projects:addfirebase $PROJECT_ID\n  firebase hosting:sites:create $HOSTING_SITE --project $PROJECT_ID\n  firebase hosting:channel:create qa --project $PROJECT_ID --site $HOSTING_SITE"
fi

echo ">>> Create placeholder secrets (QA/PROD)"
for S in WHATSAPP_VERIFY_TOKEN WHATSAPP_ACCESS_TOKEN WABA_PHONE_NUMBER_ID OPENAI_API_KEY GEMINI_API_KEY; do
  echo "placeholder" | gcloud secrets create "${S}_QA"   --data-file=- 2>/dev/null || gcloud secrets versions add "${S}_QA"   --data-file=- >/dev/null
  echo "placeholder" | gcloud secrets create "${S}_PROD" --data-file=- 2>/dev/null || gcloud secrets versions add "${S}_PROD" --data-file=- >/dev/null
done

cat <<EOF

==============================================================
Bootstrap finished.

Add these GitHub Action secrets to your repo (Settings → Secrets → Actions):

  GCP_PROJECT_ID                 = $PROJECT_ID
  GCP_REGION                     = $REGION
  WIF_PROVIDER                   = $WIF_PROVIDER_PATH
  DEPLOYER_SA                    = $DEPLOYER_SA
  GCP_CONTROL_PLANE_PROJECT_NUMBER = $PROJECT_NUMBER  <-- NEW AND IMPORTANT
  (optional) FIREBASE_TOKEN      = output of 'firebase login:ci'

IMPORTANT MANUAL STEP:
The service account for the control plane ('$RUNNER_SA')
needs permissions to create projects in your organization. Grant it the following
roles on the GCP Folder or Organization where new projects will be created:
  - Project Creator
  - Billing User

Example command:
gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID \\
  --member="serviceAccount:$RUNNER_SA" --role="roles/resourcemanager.projectCreator"
gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID \\
  --member="serviceAccount:$RUNNER_SA" --role="roles/billing.user"

Then push to 'dev' to deploy QA (cp-unified-qa), or 'main' for Prod (cp-unified).
==============================================================
EOF

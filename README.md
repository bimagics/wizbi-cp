# WIZBI Control-Plane (Unified Service) main A
> Start-from-zero skeleton: GitHub-only + Cloud Shell, GCP-native (Cloud Run/Build, Artifact Registry, Secret Manager, Firestore, Firebase Hosting/Auth), OIDC/WIF. No React — Vanilla web.

## What this repo gives you
- One service (`cp-unified`) with static UI (Vanilla) + API (Express) + ready routes (`/health`).
- CI/CD: every push deploys automatically — `dev → QA` (`cp-unified-qa`), `main → Prod` (`cp-unified`).
- Cloud Build builds the Docker image and pushes to Artifact Registry.
- Firebase Hosting channels: `qa` / `live` (optional; needs `FIREBASE_TOKEN` secret).
- Bootstrap scripts to set up your new GCP project with minimum roles and WIF (no SA keys in GitHub).

---

## Quick Start (zero → running)
### 1) Create a new empty GitHub repo (e.g. `wizbi-cp`) and upload this code.
Do not add any secrets yet.

### 2) In **Cloud Shell**, run the one-liner (fill YOUR values first):
```bash
PROJECT_ID="wizbi-cp" REGION="europe-west1" FIRESTORE_LOCATION="eur3" AR_REPO="wizbi" BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX" GITHUB_OWNER="YOUR_GH_ORG_OR_USER" GITHUB_REPO="wizbi-cp" WIF_POOL="github-pool" WIF_PROVIDER="github-provider" HOSTING_SITE="wizbi-cp" bash -c 'git clone https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git && cd ${GITHUB_REPO} && chmod +x tools/bootstrap_cp.sh && ./tools/bootstrap_cp.sh'
```

This will:
- Enable APIs, create Artifact Registry, Service Accounts (deployer/runner/factory), IAM roles.
- Set up **Workload Identity Federation** for GitHub (`dev`/`main` only).
- Initialize Firestore (Native) in `FIRESTORE_LOCATION` and App Engine region (one time).
- (If you authenticate `firebase-tools`) add your project to Firebase and create Hosting site + `qa` channel.
- Create placeholder secrets (`*_QA` / `*_PROD`).

### 3) Add the following **GitHub Action secrets** (Repo → Settings → Secrets → Actions):
- `GCP_PROJECT_ID` = your `$PROJECT_ID`
- `GCP_REGION` = your `$REGION`
- `WIF_PROVIDER` = value printed by the bootstrap (or: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/WIF_POOL/providers/WIF_PROVIDER`)
- `DEPLOYER_SA` = `wizbi-deployer@${PROJECT_ID}.iam.gserviceaccount.com`
- (optional) `FIREBASE_TOKEN` = from `firebase login:ci` if you want CI to deploy Hosting

### 4) Push to `dev` → watch the pipeline deploy `cp-unified-qa`.
Push to `main` → deploys `cp-unified`.

---

## What to customize next
- `public/index.html` — your minimal UI.
- Add routes under `src/routes` (e.g., `/whatsapp/webhook`) and services under `src/services`.
- Fill `cloudrun/service.env.sample` and wire env vars in the workflow (later).

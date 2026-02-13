# WIZBI Control Plane 🚀

**A self-service PaaS that provisions complete cloud infrastructure on GCP with one click.**

WIZBI turns a bare GCP organization into a full project-factory: organizations, isolated GCP projects, GitHub repos from templates, Firebase Hosting, Cloud Run, CI/CD — all automated.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  WIZBI Control Plane                    │
│  Node.js / Express / TypeScript on Cloud Run            │
│  Firestore DB · Firebase Auth · Secret Manager          │
├─────────────────────────────────────────────────────────┤
│  Admin Panel (Firebase Hosting)                         │
│  Organizations · Projects · Templates · Settings        │
└─────────┬───────────────────────────────────┬───────────┘
          │ provisions                        │ provisions
    ┌─────▼─────┐                      ┌──────▼──────┐
    │ GCP Folder │                      │ GitHub Team │
    │ (per Org)  │                      │ (per Org)   │
    └─────┬──────┘                      └──────┬──────┘
          │                                    │
    ┌─────▼──────────────────────────────────▼──────┐
    │              Per-Project Resources             │
    │  GCP Project · Firebase · Cloud Run · Hosting  │
    │  Artifact Registry · WIF · GitHub Repo (from   │
    │  template) · CI/CD secrets injected            │
    └────────────────────────────────────────────────┘
```

### Hierarchy

| Concept        | GCP Resource     | GitHub Resource  |
|----------------|------------------|------------------|
| Control Plane  | GCP Project      | This repository  |
| Organization   | GCP Folder       | GitHub Team      |
| Project        | GCP Project      | Private Repo     |

---

## What Gets Provisioned (Per Project)

When you click **"Create Project"** in the Admin Panel:

1. **GCP Project** — created under the org's folder, billing linked
2. **APIs enabled** — Cloud Run, Firebase, Artifact Registry, IAM, etc.
3. **Firebase** — added to the project with Hosting sites (prod + QA)
4. **Cloud Run** — placeholder services deployed (prod + QA)
5. **Service Account** — deployer SA with least-privilege roles
6. **Workload Identity Federation** — keyless GitHub → GCP auth
7. **GitHub Repo** — cloned from the selected template
8. **File Customization** — `{{PROJECT_ID}}`, `{{GCP_REGION}}` replaced
9. **Secrets Injected** — deployment secrets pushed to GitHub Actions
10. **CI/CD triggered** — initial deployment kicked off automatically

All within minutes, with live progress in the Admin Panel.

---

## Tech Stack

| Layer          | Technology                                    |
|----------------|-----------------------------------------------|
| Backend        | Node.js, Express, TypeScript                  |
| Database       | Firestore (Native Mode)                       |
| Auth           | Firebase Authentication                       |
| Hosting        | Cloud Run (API), Firebase Hosting (Frontend)  |
| CI/CD          | GitHub Actions + Workload Identity Federation |
| Infrastructure | GCP APIs, Shell Scripts                       |

---

## 🚀 One-Click Installation

### Prerequisites

- A GCP Organization with a Billing Account
- A GitHub Organization (or user account) with admin permissions
- Access to [Google Cloud Shell](https://console.cloud.google.com)

### Deploy

Click the button below or run the command in Cloud Shell:

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://console.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/bimagics/wizbi-cp&cloudshell_git_branch=main&cloudshell_tutorial=tools/tutorial.md&cloudshell_workspace=.)

```bash
git clone https://github.com/bimagics/wizbi-cp.git && \
cd wizbi-cp && \
chmod +x tools/bootstrap_full.sh && \
./tools/bootstrap_full.sh
```

The interactive wizard will ask for:
- **Billing Account** — auto-detected, select from list
- **Project ID** — auto-generated unique ID (or provide your own)
- **Admin Email** — auto-detected from `gcloud` auth
- **GitHub Owner** — your GitHub org or username
- **GitHub Repo** — name of this repo (default: `wizbi-cp`)

Everything else is automatic. The script:
1. Creates the GCP project and enables all APIs
2. Sets up Firebase, Firestore, and Hosting sites
3. Creates service accounts with least-privilege IAM
4. Installs Firebase CLI and configures hosting targets
5. Builds and deploys the Control Plane to Cloud Run
6. Deploys the Admin Panel to Firebase Hosting
7. Configures Workload Identity Federation for CI/CD
8. Optionally injects GitHub Actions secrets (if PAT provided)

### After Installation

1. Open `https://YOUR_PROJECT_ID.web.app/admin/`
2. Log in with the admin email you provided
3. Go to **Settings** → configure your GitHub App keys
4. Start creating organizations and provisioning projects!

---

## CI/CD

| Branch  | Deploys To  |
|---------|-------------|
| `main`  | Production  |
| `dev`   | QA          |

The GitHub Actions workflow (`.github/workflows/deploy.yml`) handles:
- Docker image build with layer caching
- Push to Artifact Registry
- Cloud Run deployment with health verification
- Firebase Hosting deployment

Authentication is fully keyless via Workload Identity Federation.

### Required GitHub Secrets

These are automatically injected by the bootstrap script if you provide a GitHub PAT.
Otherwise, set them manually under **Settings → Secrets → Actions**:

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Control plane project ID |
| `GCP_REGION` | Deployment region (e.g., `europe-west1`) |
| `WIF_PROVIDER` | WIF provider path |
| `DEPLOYER_SA` | Deployer service account email |
| `GCP_CONTROL_PLANE_PROJECT_NUMBER` | Project number |
| `BILLING_ACCOUNT_ID` | Billing account ID |
| `ADMINS` | Comma-separated admin emails |

---

## Template Management

To add a new project template:

1. Create a GitHub repo named `template-<name>` (e.g., `template-nextjs-blog`)
2. Mark it as a **template repository** in GitHub settings
3. Use placeholders in files: `{{PROJECT_ID}}`, `{{PROJECT_DISPLAY_NAME}}`, `{{GCP_REGION}}`

The Admin Panel auto-discovers all `template-*` repos in your org.

---

## Project Structure

```
├── src/
│   ├── index.ts              # Express server, CORS, routes
│   ├── routes/
│   │   ├── health.ts         # Health check
│   │   ├── user.ts           # User profile & roles
│   │   ├── projects.ts       # Project CRUD & provisioning
│   │   ├── orgs.ts           # Organization management
│   │   ├── github.ts         # Template management
│   │   └── settings.ts       # Secrets & config
│   └── services/
│       ├── firebaseAdmin.ts  # Firebase Admin SDK init
│       ├── gcp.ts            # GCP provisioning engine
│       ├── gcp_legacy.ts     # GCP folder operations
│       ├── github.ts         # GitHub API integration
│       └── secrets.ts        # Secret Manager wrapper
├── public/
│   ├── index.html            # Landing page
│   └── admin/                # Admin Panel (HTML/CSS/JS)
├── tools/
│   ├── bootstrap_full.sh     # One-click setup wizard
│   └── tutorial.md           # Cloud Shell tutorial
├── .github/workflows/
│   └── deploy.yml            # CI/CD pipeline
├── Dockerfile                # Multi-stage production build
└── firebase.json             # Hosting config (targets)
```

---

## License

MIT

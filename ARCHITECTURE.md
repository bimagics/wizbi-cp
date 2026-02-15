# Architecture — WIZBI Control Plane

> **What is this?** A self-service PaaS that provisions complete GCP + GitHub infrastructure with one click.

---

## System Diagram

```mermaid
graph TB
    subgraph "Frontend — Firebase Hosting"
        UI["Admin Panel<br/>HTML/CSS/JS"]
        LP["Setup Wizard<br/>public/index.html"]
    end

    subgraph "Backend — Cloud Run"
        API["Express API<br/>src/index.ts"]
        AUTH["Auth Middleware<br/>Firebase Token + API Key"]
        MCP_SRV["MCP Server<br/>SSE Transport"]
        SWAGGER["Swagger UI<br/>OpenAPI 3.1"]
    end

    subgraph "Routes"
        R_PROJ["projects.ts — CRUD + provisioning"]
        R_ORGS["orgs.ts — Organization management"]
        R_GH["github.ts — Template CRUD"]
        R_GHSETUP["github-setup.ts — GitHub App wizard"]
        R_SETTINGS["settings.ts — Secrets management"]
        R_APIKEYS["api-keys.ts — API key management"]
        R_USER["user.ts — Profile + roles"]
        R_HEALTH["health.ts — Health + Firebase config"]
    end

    subgraph "Services"
        S_GCP["gcp.ts — GCP provisioning engine"]
        S_GH["github.ts — GitHub App integration"]
        S_BILLING["billing.ts — Cost tracking (BQ)"]
        S_SECRETS["secrets.ts — Secret Manager"]
        S_FIREBASE["firebaseAdmin.ts — Firebase SDK"]
        S_LEGACY["gcp_legacy.ts — Folder operations"]
    end

    subgraph "External Services"
        GCP["Google Cloud Platform"]
        GITHUB["GitHub API"]
        FIRESTORE["Firestore"]
        SECRETMGR["Secret Manager"]
        BQ["BigQuery"]
    end

    UI --> API
    API --> AUTH --> R_PROJ & R_ORGS & R_GH & R_GHSETUP & R_SETTINGS & R_APIKEYS & R_USER & R_HEALTH
    API --> MCP_SRV
    API --> SWAGGER
    R_PROJ --> S_GCP & S_GH
    R_ORGS --> S_GCP & S_GH
    R_GH --> S_GH
    R_PROJ --> S_BILLING
    R_SETTINGS --> S_SECRETS
    S_GCP --> GCP
    S_GH --> GITHUB
    S_BILLING --> BQ
    S_SECRETS --> SECRETMGR
    S_FIREBASE --> FIRESTORE
```

---

## Module Map

### `src/routes/` — API Endpoints

| File | Prefix | Purpose |
|------|--------|---------|
| `health.ts` | `/api/healthz`, `/api/firebase-config` | Health check, Firebase config for frontend |
| `user.ts` | `/api/user/*` | User profile, role management |
| `projects.ts` | `/api/projects/*` | CRUD, provisioning, billing, retry, delete |
| `orgs.ts` | `/api/orgs/*` | Organization CRUD (creates GCP folder + GitHub team) |
| `github.ts` | `/api/github/*` | Template listing, creation, deletion |
| `github-setup.ts` | `/api/github-setup/*` | GitHub App creation wizard + webhook |
| `settings.ts` | `/api/settings/*` | Secret Manager CRUD via Admin Panel |
| `api-keys.ts` | `/api/api-keys/*` | Programmatic API key management |

### `src/services/` — Business Logic

| File | Purpose |
|------|---------|
| `gcp.ts` | Full GCP provisioning: project, APIs, Firebase, Cloud Run, AR, IAM, WIF |
| `gcp_legacy.ts` | GCP Folder creation/deletion (Organization-level operations) |
| `github.ts` | GitHub App auth, repo from template, file customization, secrets injection, CI/CD trigger |
| `billing.ts` | Two-tier: Cloud Billing API (account info) + BigQuery (cost data) |
| `secrets.ts` | Secret Manager read/write wrapper |
| `firebaseAdmin.ts` | Firebase Admin SDK singleton |

### `src/mcp/` — Model Context Protocol Server

| File | Purpose |
|------|---------|
| `index.ts` | SSE transport, session management, `/api/mcp/sse` endpoint |
| `tools.ts` | 15+ tools mapping 1:1 to REST API operations |
| `resources.ts` | Read-only resource endpoints for AI context |

### `src/middleware/`

| File | Purpose |
|------|---------|
| `auth.ts` | Unified auth: Firebase ID Token + API Key, role checks |

---

## Provisioning Pipeline

When a user clicks **"Create Project"** in the Admin Panel:

```mermaid
sequenceDiagram
    participant UI as Admin Panel
    participant API as Express API
    participant GCP as GCP APIs
    participant GH as GitHub API
    participant FS as Firestore

    UI->>API: POST /api/projects
    API->>FS: Create project doc (state: provisioning)
    API->>GCP: createProject + linkBilling
    API->>GCP: enableAPIs (12 APIs)
    API->>GCP: addFirebase
    API->>GCP: createArtifactRegistry
    API->>GCP: createServiceAccount + grantRoles
    API->>GCP: setupWIF (keyless GitHub auth)
    API->>GCP: deployPlaceholderCloudRun (prod + qa)
    API->>GCP: createHostingSites (prod + qa)
    API->>GH: createRepoFromTemplate
    API->>GH: customizeFiles (replace {{placeholders}})
    API->>GH: injectSecrets (GCP_PROJECT_ID, etc.)
    API->>GH: triggerInitialDeployment
    API->>FS: Update project doc (state: ready)
    API-->>UI: SSE progress updates
```

**Provisioned resources per project:**
- GCP Project (under org folder, billing linked)
- 12 GCP APIs enabled
- Firebase + Firestore + Hosting (prod + QA)
- Cloud Run services (prod + QA) with placeholder image
- Artifact Registry Docker repo
- Service Account with least-privilege IAM roles
- Workload Identity Federation (keyless GitHub → GCP auth)
- GitHub repo (from template, files customized, secrets injected)
- CI/CD pipeline triggered automatically

---

## Authentication

Two authentication strategies, unified in `src/middleware/auth.ts`:

| Method | Header | Use Case |
|--------|--------|----------|
| Firebase ID Token | `Authorization: Bearer <token>` | Browser-based Admin Panel |
| API Key | `X-API-Key: <key>` | Programmatic access, MCP clients |

API keys are SHA-256 hashed and stored in Firestore. Both strategies resolve to a user profile with roles (`superAdmin`, `orgAdmin`).

---

## Data Model (Firestore)

| Collection | Key Fields | Purpose |
|------------|-----------|---------|
| `orgs` | `name`, `gcpFolderId`, `githubTeamSlug` | Organizations |
| `projects` | `displayName`, `orgId`, `state`, `template` | Projects + provisioning state |
| `userProfiles` | `email`, `roles.superAdmin`, `roles.orgAdmin[]` | User roles |
| `apiKeys` | `hashedKey`, `userId`, `name` | API key registry |
| `logs` (subcollection under projects) | `event`, `data`, `timestamp` | Provisioning audit trail |
| `globalLinks` / project `links` | `name`, `url`, `icon` | Custom dashboard links |

---

## Environment Variables

### Required (set by bootstrap)

| Variable | Description |
|----------|-------------|
| `GCP_PROJECT_ID` | Control plane project ID |
| `FIREBASE_PROJECT_ID` | Same as GCP_PROJECT_ID |
| `BILLING_ACCOUNT_ID` | GCP billing account ID |
| `ADMINS` | Comma-separated admin emails |
| `GCP_CONTROL_PLANE_PROJECT_NUMBER` | Project number (for IAM) |
| `GITHUB_OWNER` | GitHub org or user |
| `CORS_ORIGIN` | Allowed origins (auto-derived if not set) |

### Optional

| Variable | Description |
|----------|-------------|
| `FIREBASE_API_KEY` | Firebase Web API key (for direct Cloud Run access) |
| `GCP_DEFAULT_REGION` | Default region (default: `europe-west1`) |
| `BILLING_BQ_PROJECT` | BigQuery project for cost data |
| `BILLING_BQ_DATASET` | BigQuery dataset name |
| `BILLING_BQ_TABLE` | BigQuery export table name |

---

## CI/CD Pipeline

```
Push to `dev`  → build → deploy Cloud Run (cp-unified-qa) → deploy Hosting (QA)
Push to `main` → build → deploy Cloud Run (cp-unified)    → deploy Hosting (prod)
```

Authentication is **keyless** via Workload Identity Federation — no service account keys stored in GitHub.

---

## Key Integrations

| Integration | API | Purpose |
|-------------|-----|---------|
| GCP Resource Manager | `cloudresourcemanager.googleapis.com` | Project/Folder CRUD |
| GCP Cloud Billing | `cloudbilling.googleapis.com` | Link billing, cost data |
| GCP Cloud Run | `run.googleapis.com` | Deploy services |
| GCP Artifact Registry | `artifactregistry.googleapis.com` | Docker image storage |
| GCP IAM | `iam.googleapis.com` | Service accounts, WIF |
| GCP Secret Manager | `secretmanager.googleapis.com` | Secure credential storage |
| GCP BigQuery | `bigquery.googleapis.com` | Billing cost queries |
| Firebase | `firebase.googleapis.com` | Auth, Firestore, Hosting |
| GitHub REST API | `api.github.com` | Repos, teams, secrets, workflows |

# AGENTS.md — AI Agent Context for WIZBI Control Plane

> This file helps AI coding agents understand this repository quickly.
> It follows the emerging `AGENTS.md` convention for AI-friendly open-source projects.

---

## What This Repo Does

WIZBI Control Plane is a **self-service PaaS** that provisions complete cloud infrastructure on GCP with one click. It creates GCP projects, GitHub repos (from templates), Firebase hosting, Cloud Run services, CI/CD pipelines, and more — all automated.

**Think of it as:** A project factory. An admin creates an "organization", then provisions "projects" under it. Each project gets its own GCP project, GitHub repo, and deployment pipeline.

---

## Tech Stack

- **Backend:** Node.js / Express / TypeScript (runs on Cloud Run)
- **Database:** Firestore (native mode)
- **Auth:** Firebase Authentication (Google Sign-In)
- **Frontend:** Vanilla HTML/CSS/JS (served via Firebase Hosting)
- **CI/CD:** GitHub Actions + Workload Identity Federation (keyless)

---

## Project Layout

```
src/
├── index.ts              # Express server entry point
├── middleware/auth.ts     # Unified auth (Firebase Token + API Key)
├── routes/               # REST API endpoints
│   ├── projects.ts       # Project CRUD + GCP provisioning trigger
│   ├── orgs.ts           # Organization CRUD
│   ├── github.ts         # Template listing + creation
│   ├── github-setup.ts   # GitHub App creation wizard
│   ├── settings.ts       # Secret Manager CRUD
│   ├── api-keys.ts       # API key management
│   ├── user.ts           # User profile + roles
│   └── health.ts         # Health check + Firebase config
├── services/             # Core business logic
│   ├── gcp.ts            # GCP provisioning engine (the big one)
│   ├── github.ts         # GitHub App integration (repos, templates, secrets)
│   ├── billing.ts        # Cost tracking (Cloud Billing API + BigQuery)
│   ├── gcp_legacy.ts     # GCP folder operations
│   ├── secrets.ts        # Secret Manager wrapper
│   └── firebaseAdmin.ts  # Firebase Admin SDK singleton
├── mcp/                  # Model Context Protocol server
│   ├── index.ts          # SSE transport + session management
│   ├── tools.ts          # 15+ tools (create org, provision project, etc.)
│   └── resources.ts      # Read-only resources for AI context
├── openapi.yaml          # OpenAPI 3.1 spec (all endpoints documented)
└── types/                # TypeScript type stubs

public/
├── admin/                # Admin Panel (HTML/CSS/JS)
│   ├── index.html        # Main SPA shell
│   ├── admin.js          # All admin logic
│   └── admin.css         # Styles
└── index.html            # Setup wizard / landing page

tools/
├── bootstrap_full.sh     # One-click GCP setup script
├── setup_billing_export.sh  # BigQuery billing export setup
└── tutorial.md           # Cloud Shell guided tutorial
```

---

## Key Files to Understand First

| Priority | File | Why |
|----------|------|-----|
| 🔴 | `src/services/gcp.ts` | Core provisioning engine — creates GCP projects, enables APIs, deploys services |
| 🔴 | `src/services/github.ts` | Template cloning, file customization, secret injection, CI/CD trigger |
| 🔴 | `src/routes/projects.ts` | Orchestrates the full provisioning pipeline |
| 🟡 | `src/middleware/auth.ts` | All auth logic — Firebase tokens + API keys |
| 🟡 | `src/mcp/tools.ts` | MCP tools — the AI-agent interface |
| 🟡 | `tools/bootstrap_full.sh` | One-click setup — creates everything from scratch |
| 🟢 | `src/openapi.yaml` | Full API specification |
| 🟢 | `ARCHITECTURE.md` | Detailed system architecture |

---

## Things to Preserve (Don't Break These)

1. **Provisioning pipeline** (`projects.ts` → `gcp.ts` → `github.ts`) — This is the core value. Changes here should be tested end-to-end.
2. **Authentication flow** — Both Firebase tokens AND API keys must work. The unified middleware in `auth.ts` handles both.
3. **Bootstrap script** (`tools/bootstrap_full.sh`) — Must remain idempotent (safe to re-run). Uses `2>/dev/null || true` pattern for idempotency.
4. **CI/CD pipeline** (`.github/workflows/deploy.yml`) — Environment variables must stay in sync with what the bootstrap script sets.
5. **Firestore collections** — `orgs`, `projects`, `userProfiles`, `apiKeys` — schema changes need migration consideration.
6. **Template placeholder convention** — `{{PROJECT_ID}}`, `{{GCP_REGION}}`, `{{PROJECT_DISPLAY_NAME}}` — used in GitHub template repos.
7. **MCP tools** — Must stay in sync with REST API endpoints.
8. **OpenAPI spec** — Must stay in sync with actual routes.

---

## Common Workflows

### Adding a New API Endpoint
1. Create or modify a route in `src/routes/`
2. Add corresponding MCP tool in `src/mcp/tools.ts`
3. Update `src/openapi.yaml`
4. If it needs auth, use `requireAuth` or `requireAdminAuth` from `../middleware/auth`

### Adding a New Environment Variable
1. Add to `.env.example`
2. Add to `tools/bootstrap_full.sh` (Cloud Run deploy commands, lines ~770-790)
3. Add to `.github/workflows/deploy.yml` (line ~89)
4. If needed in CI/CD, add to GitHub secrets injection in bootstrap (~lines 930-950)

### Modifying the Provisioning Pipeline
1. Edit `src/services/gcp.ts` for GCP resource changes
2. Edit `src/services/github.ts` for GitHub/template changes
3. Edit `src/routes/projects.ts` for orchestration changes
4. Test with a real GCP project — there's no mock/sandbox mode

---

## API Access Points

| Interface | URL | Auth |
|-----------|-----|------|
| REST API | `/api/*` | Firebase Token or API Key |
| Swagger UI | `/api/docs` | None (read-only) |
| OpenAPI Spec | `/api/openapi.json` | None |
| MCP Server | `/api/mcp/sse` | API Key (query param or header) |
| Admin Panel | `/admin/` | Firebase Google Sign-In |
| Health Check | `/healthz` | None |

---

## Build & Run

```bash
# Install
npm install

# Development
npm run dev

# Production build
npm run build

# Type check
npx tsc --noEmit
```

---

## Conventions

- **Error handling:** Routes catch errors and return `{ ok: false, error: 'error-code' }`
- **Logging:** Use `log(event, data)` from `../middleware/auth` — logs to Firestore
- **Auth:** Always use middleware from `../middleware/auth`, never roll your own
- **Naming:** Routes use kebab-case URLs, services use camelCase functions
- **Config:** All config via environment variables, no config files

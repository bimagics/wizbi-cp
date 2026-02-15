# Contributing to WIZBI Control Plane

Thank you for your interest in contributing! 🎉

## Getting Started

1. **Fork** this repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/wizbi-cp.git
   cd wizbi-cp
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Copy the env example:**
   ```bash
   cp .env.example .env
   ```
5. **Fill in your `.env`** with your GCP project details
6. **Run the dev server:**
   ```bash
   npm run dev
   ```

## Development Workflow

- Create a feature branch from `dev`: `git checkout -b feature/my-feature dev`
- Make your changes
- Run `npm run build` to ensure TypeScript compiles correctly
- Submit a Pull Request against the `dev` branch

## Project Structure

```
src/
├── index.ts          # Express server entry point
├── routes/           # API route handlers
│   ├── health.ts     # Health check + Firebase config
│   ├── user.ts       # User profile & roles
│   ├── projects.ts   # Project CRUD + provisioning
│   ├── orgs.ts       # Organization management
│   ├── github.ts     # Template repository management
│   └── settings.ts   # Secret management
├── services/         # Core business logic
│   ├── gcp.ts        # GCP provisioning (projects, IAM, Cloud Run)
│   ├── github.ts     # GitHub API integration
│   ├── firebaseAdmin.ts  # Firebase Admin SDK init
│   ├── secrets.ts    # Secret Manager access
│   └── gcp_legacy.ts # Legacy GCP functions
└── types/            # TypeScript type definitions
```

## Deployment

Automatic via GitHub Actions on push to `dev` (QA) or `main` (Production).

## Code of Conduct

Be respectful and constructive. We're all here to build something great.

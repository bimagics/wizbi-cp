# WIZBI Control Plane — Setup Tutorial

## Welcome to WIZBI! 🚀

This tutorial will guide you through setting up your own WIZBI Control Plane on Google Cloud Platform.

**What you'll get:**
- A fully functional project provisioning system
- Admin Panel to manage organizations and projects
- Automated CI/CD pipeline via GitHub Actions
- Firebase Hosting + Cloud Run backend

**What you'll need:**
- A GCP Billing Account
- A GitHub organization or user account
- ~5 minutes ☕

---

## Step 1: Run the Setup Script

Open the terminal below and run:

```bash
chmod +x tools/bootstrap_full.sh && ./tools/bootstrap_full.sh
```

The interactive wizard will ask for:
- **Billing Account** — auto-detected from your GCP account
- **Project ID** — auto-generated (or provide your own)
- **Admin Email** — auto-detected from your `gcloud` login
- **GitHub Owner** — your GitHub org or username
- **GitHub Repo** — name of this repo (default: `wizbi-cp`)

---

## Step 2: Wait for Setup (~5 minutes)

The script will automatically:
1. Create a GCP project and enable 15 APIs
2. Set up Firestore, Artifact Registry, and 3 Service Accounts
3. Configure Workload Identity Federation for GitHub Actions
4. Install Firebase CLI and set up Hosting (Production + QA)
5. Build and deploy the application to Cloud Run
6. Create secrets in Secret Manager

---

## Step 3: Open Your Admin Panel

Once the script finishes, it will print your Admin Panel URL.

Open it in your browser and log in with Google.

---

## Step 4: Configure API Keys

In the Admin Panel, go to **Settings** and enter your API keys:

- **GitHub App** — Required for project provisioning

---

## Congratulations! 🎉

Your WIZBI Control Plane is ready. You can now:
- Create Organizations
- Provision new GCP Projects from templates
- Manage users and permissions

For CI/CD: push to `dev` for QA, push to `main` for Production.

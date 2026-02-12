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
- ~5 minutes ☕

---

## Step 1: Run the Setup Script

The script will ask you a few questions and then set everything up automatically.

```bash
chmod +x tools/bootstrap_full.sh && ./tools/bootstrap_full.sh
```

This will:
1. Create a GCP project and enable all required APIs
2. Set up Firestore, Artifact Registry, and Service Accounts
3. Configure Workload Identity Federation for GitHub Actions
4. Set up Firebase Hosting (Production + QA)
5. Build and deploy the application to Cloud Run
6. Create placeholder secrets in Secret Manager

---

## Step 2: Open Your Admin Panel

Once the script finishes, it will print your Admin Panel URL.

Open it in your browser and log in with Google.

---

## Step 3: Configure API Keys

In the Admin Panel, go to **Settings** and enter your API keys:

- **GitHub App** — Required for project provisioning

---

## Congratulations! 🎉

Your WIZBI Control Plane is ready. You can now:
- Create Organizations
- Provision new GCP Projects from templates
- Manage users and permissions

For CI/CD: push to `dev` for QA, push to `main` for Production.

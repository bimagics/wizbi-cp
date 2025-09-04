# WIZBI Control Plane 🚀

## 1. Vision & Mission

**Our Mission:** To build a Platform-as-a-Service (PaaS) that acts as an "Operating System for Businesses" on the Google Cloud Platform (GCP).

WIZBI empowers businesses, even those without technical expertise, to instantly provision a complete, modern, and secure cloud infrastructure. We abstract away the complexities of cloud management, providing a simple control plane where customers can launch and manage their digital products.

The long-term vision is to enable the development of these products using natural language, powered by AI. Our platform will automatically handle all the "plumbing" behind the scenes, turning ideas into reality seamlessly.

---

## 2. Guiding Principles & Architecture

Every technical decision is driven by these core principles:

-   **Radical Simplicity:** The user interacts with a clean, intuitive interface. All complexity remains "under the hood."
-   **Lean & Cost-Effective:** A Serverless-first architecture (Cloud Run, Firestore) minimizes fixed costs, scaling with usage.
-   **Secure by Design:** Fully isolated environments for each customer project, adhering to the principle of least privilege.
-   **Template-Driven Management:** Ensures uniformity, prevents configuration drift, and simplifies platform-wide upgrades.

### Architectural Hierarchy

The platform is structured in a clear hierarchy, mapping business concepts to cloud resources:

1.  **The Control Plane:** The central "brain" of the system. It's a GCP project (`wizbi-cp`) running a Node.js/Express application on **Cloud Run**, with **Firestore** as its database.
2.  **Organization:** Represents a customer. This maps to a **GCP Folder** for resource isolation and a **GitHub Team** for access control.
3.  **Project:** Represents a specific digital product or infrastructure for a customer. This maps to a dedicated **GCP Project** and a private **GitHub Repository**.

---

## 3. Technology Stack

-   **Backend:** Node.js, Express.js, TypeScript
-   **Database:** Google Firestore (Native Mode)
-   **Hosting:** Google Cloud Run (Backend), Firebase Hosting (Frontend)
-   **Authentication:** Firebase Authentication (for the admin panel)
-   **Cloud Infrastructure:** Google Cloud Platform (Resource Manager, Billing, IAM)
-   **Source Control & CI/CD:** GitHub, GitHub Actions, GitHub Apps
-   **Infrastructure as Code:** Google Cloud CLI (`gcloud`) within shell scripts.

---

## 4. ✨ The AI-First Development Workflow

**Important:** We operate in a modern, cloud-native environment. **There is no local development.**

-   **No Local IDE:** We do not run or test code on our personal machines. This eliminates environment inconsistencies and streamlines development.
-   **Primary Interfaces: GitHub & Cloud Shell:** All code changes are made directly in the GitHub web interface. All infrastructure commands, tests, and bootstrap operations are executed via **Google Cloud Shell**.
-   **AI-Driven Development:** Our core development process is a conversation with an AI partner (like Google's Gemini). We describe requirements in natural language, receive complete code snippets, and paste them into the appropriate files on GitHub. The AI is our pair programmer.

This methodology ensures development velocity, code uniformity, and allows us to focus on solving business problems instead of managing development environments.

### Working with an AI Partner (like me)

To ensure maximum efficiency when collaborating:

1.  **Be Specific:** Clearly state your goal (e.g., "Add a delete button to the projects table").
2.  **Provide Full Context:** Always provide the complete, most recent versions of the files you want to modify. This is crucial as I have no memory of past files.
3.  **Work in Logical Steps:** Break down large features into smaller, testable steps (e.g., 1. Add UI button, 2. Create backend endpoint, 3. Implement deletion logic).
4.  **Request Full Code:** Always ask for the "full code for the file" to replace, not just a diff or a snippet. This prevents errors.
5.  **Test and Report Back:** After deploying a change, report the results. If there are errors, provide the full logs from Cloud Run. This creates a tight feedback loop.

---

## 5. 🚀 Getting Started: Bootstrapping the Control Plane

This process sets up the entire WIZBI Control Plane project from scratch in your GCP organization.

### Prerequisites

-   A Google Cloud Organization with a Billing Account.
-   A GitHub Organization or user account.
-   Permissions to create GCP projects, folders, and manage billing.
-   `gcloud` CLI and `firebase-tools` installed, or access to Google Cloud Shell.

### Step 1: Run the Bootstrap Script

Open **Cloud Shell** in your GCP account and run the command below after filling in your details. This script performs all the initial setup.

```bash
# Replace placeholder values before running
PROJECT_ID="wizbi-cp" \
REGION="europe-west1" \
FIRESTORE_LOCATION="eur3" \
AR_REPO="wizbi" \
BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX" \
GITHUB_OWNER="YOUR_GH_ORG_OR_USER" \
GITHUB_REPO="wizbi-cp" \
bash -c 'git clone [https://github.com/$](https://github.com/$){GITHUB_OWNER}/${GITHUB_REPO}.git && cd ${GITHUB_REPO} && chmod +x tools/bootstrap_cp.sh && ./tools/bootstrap_cp.sh'

Step 2: Configure GitHub Secrets
The bootstrap script will output a list of secrets. Add them to your GitHub repository under Settings -> Secrets and variables -> Actions:

GCP_PROJECT_ID: The ID of your control plane project (e.g., wizbi-cp).

GCP_REGION: The region for Cloud Run deployments (e.g., europe-west1).

WIF_PROVIDER: The full path of the Workload Identity Provider.

DEPLOYER_SA: The email of the wizbi-deployer service account.

BILLING_ACCOUNT_ID: The ID of your GCP Billing Account.

Step 3: Push to Deploy
Commit and push any changes to the dev branch to deploy to the QA environment, or to the main branch to deploy to production. The GitHub Actions workflow will handle the rest.

6. Project Roadmap
This section outlines the planned development for the WIZBI platform.

[x] Phase 1: Core Provisioning:

[x] Create Organizations (GCP Folder, GitHub Team).

[x] Provision Projects (GCP Project, GitHub Repo).

[x] Link to billing and assign permissions.

[x] Basic Admin UI for creation.

[x] Phase 2: UI/UX Enhancements:

[x] Smart Project ID generation.

[x] Direct links to GCP and GitHub resources.

[x] In-UI error display and status polling.

[ ] Phase 3: Lifecycle Management:

[ ] Implement secure deletion for Projects.

[ ] Implement secure deletion for Organizations.

[ ] Live progress updates during provisioning.

[ ] Phase 4: The "Perfect Repo" Template:

[ ] Define a starter template for new projects.

[ ] Include pre-configured Firebase, CI/CD, Logging, and basic auth.

[ ] Integrate template cloning into the provisioning process.

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
3.  **Project:** Represents a specific digital product. This maps to a dedicated **GCP Project** and a private **GitHub Repository**, generated from a chosen template.

---

## 3. The Automated Provisioning Workflow

The core of WIZBI is its ability to automate the entire lifecycle of a new project from a single interface.

1.  **Initiation (Admin Panel):** An administrator selects an Organization and a **Project Template** from a dynamic list fetched directly from GitHub. They provide a display name and a short name for the new project.
2.  **Smart ID Generation:** The system automatically generates a unique, standardized Project ID based on the organization and short name (e.g., `wizbi-orgname-projectname`).
3.  **Automated Provisioning:** Once confirmed, the Control Plane executes a series of steps in the background, with live status updates in the UI:
    * **GCP Setup:** Creates a new, isolated GCP project, links it to billing, and enables all necessary APIs.
    * **Firebase Integration:** Adds Firebase services, including Firestore and Hosting, to the new project.
    * **Secure CI/CD Setup:** Provisions a dedicated Service Account and configures Workload Identity Federation (WIF) for secure, keyless deployments from GitHub.
    * **GitHub Repo Creation:** Clones the selected template into a new private GitHub repository.
    * **Dynamic Customization:** Automatically scans files like `README.md`, `firebase.json`, and `.env.example` in the new repo, replacing placeholders (`{{PROJECT_ID}}`, `{{GCP_REGION}}`) with the actual project details.
    * **Local Development Setup:** Each new project includes a pre-configured `.env.example` file with project-specific values, making it easy for developers to set up their local testing environment.
    * **Secret Injection:** Securely injects all necessary deployment secrets (like `GCP_PROJECT_ID`, `WIF_PROVIDER`, etc.) into the new repository's GitHub Actions secrets.
4.  **Ready to Develop:** Within minutes, the new project is fully configured and ready. Developers can push code to the `dev` or `main` branches to trigger automated, secure deployments to their QA and Production environments.

### Managing Project Templates

To make a new repository available as a template in the admin panel, simply:
1. Create a new repository in your GitHub organization.
2. Name it following the convention: `template-<your-template-name>` (e.g., `template-nextjs-blog`).
The Control Plane will automatically discover it and add it to the selection list.

---

## 4. Technology Stack

-   **Backend:** Node.js, Express.js, TypeScript
-   **Database:** Google Firestore (Native Mode)
-   **Hosting:** Google Cloud Run (Backend), Firebase Hosting (Frontend)
-   **Authentication:** Firebase Authentication (for the admin panel)
-   **Cloud Infrastructure:** Google Cloud Platform (Resource Manager, Billing, IAM)
-   **Source Control & CI/CD:** GitHub, GitHub Actions, GitHub Apps
-   **Infrastructure as Code:** Google APIs and Shell Scripts.

---

## 5. 🚀 Getting Started: Bootstrapping the Control Plane

This process sets up the entire WIZBI Control Plane project from scratch in your GCP organization.

### Prerequisites

-   A Google Cloud Organization with a Billing Account.
-   A GitHub Organization or user account where you have admin permissions.
-   Permissions to create GCP projects, folders, and manage billing.
-   Access to Google Cloud Shell or a local machine with `gcloud` and `firebase-tools` installed.

### Step 1: Run the Bootstrap Script

Open **Cloud Shell** in your GCP account and run the command below after filling in your details. This script performs all the initial setup for the Control Plane itself.

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
````

### Step 2: Configure GitHub Secrets

The bootstrap script will output a list of secrets. Add them to your `wizbi-cp` repository under `Settings` -\> `Secrets and variables` -\> `Actions`:

  - `GCP_PROJECT_ID`: The ID of your control plane project (e.g., `wizbi-cp`).
  - `GCP_REGION`: The region for Cloud Run deployments (e.g., `europe-west1`).
  - `WIF_PROVIDER`: The full path of the Workload Identity Provider.
  - `DEPLOYER_SA`: The email of the `wizbi-deployer` service account.
  - `GCP_CONTROL_PLANE_PROJECT_NUMBER`: The project *number* of the control plane (output by the script).
  - `BILLING_ACCOUNT_ID`: The ID of your GCP Billing Account.

### Step 3: Grant Permissions Manually

The service account used by the Control Plane (`wizbi-runner@wizbi-cp.iam.gserviceaccount.com`) needs permission to create projects and folders in your GCP Organization. This must be done manually for security reasons.

Run the following commands in Cloud Shell, replacing `YOUR_FOLDER_ID` with the ID of the GCP Folder where new customer organizations will be created:

```bash
gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID \
  --member="serviceAccount:wizbi-runner@wizbi-cp.iam.gserviceaccount.com" --role="roles/resourcemanager.projectCreator"

gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID \
  --member="serviceAccount:wizbi-runner@wizbi-cp.iam.gserviceaccount.com" --role="roles/billing.user"
```

### Step 4: Push to Deploy

Commit and push any changes to the `dev` branch to deploy to the QA environment, or to the `main` branch to deploy to production. The GitHub Actions workflow will handle the rest.

-----

## 6\. Project Roadmap

  - [x] **Phase 1: Core Provisioning:**

      - [x] Create Organizations (GCP Folder, GitHub Team).
      - [x] Provision Projects (GCP Project, GitHub Repo).
      - [x] Link to billing and assign permissions.
      - [x] Basic Admin UI for creation.

  - [x] **Phase 2: UI/UX & Workflow Enhancements:**

      - [x] Fully automated, multi-stage provisioning process.
      - [x] Smart, standardized project ID generation.
      - [x] Live in-UI status polling and progress bars.
      - [x] Direct links to newly created GCP and GitHub resources.
      - [x] In-UI log viewer.

  - [x] **Phase 3: Template-Driven Architecture:**

      - [x] Defined a starter template (`template-wizbi-mono`) for new projects.
      - [x] Integrated dynamic template discovery from GitHub.
      - [x] Implemented automatic customization of template files post-creation.

  - [ ] **Phase 4: Lifecycle Management:**

      - [ ] Implement secure, multi-stage deletion for Projects.
      - [ ] Implement secure, multi-stage deletion for Organizations.
      - [ ] Add role-based access control (Org Admin vs Super Admin) refinements.

<!-- end list -->

[ ] Implement secure, multi-stage deletion for Organizations.

[ ] Add role-based access control (Org Admin vs Super Admin) refinements.

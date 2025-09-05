// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/services/gcp.ts

import { google, cloudresourcemanager_v3, iam_v1, serviceusage_v1, firebase_v1beta1 } from 'googleapis';
import { log } from '../routes/projects';
import * as GcpLegacyService from './gcp_legacy';

// Environment variables used by the service
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || ''; // Project number of the control plane

// Helper to get authenticated client
async function getAuth() {
    return google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

// --- Interfaces for structured return types ---
export interface ProvisionResult {
    projectId: string;
    projectNumber: string;
    serviceAccountEmail: string;
    wifProviderName: string;
}

/**
 * A comprehensive function to provision a new GCP project with all necessary infrastructure.
 * This function is designed to be idempotent where possible.
 */
export async function provisionProjectInfrastructure(projectId: string, displayName: string, folderId: string): Promise<ProvisionResult> {
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });
    const iam = google.iam({ version: 'v1', auth });
    const serviceUsage = google.serviceusage({ version: 'v1', auth });
    const firebase = google.firebase({ version: 'v1beta1', auth });

    // --- 1. Create Project (if not exists) and Link Billing ---
    await createProjectAndLinkBilling(crm, projectId, displayName, folderId);
    const projectNumber = await getProjectNumber(crm, projectId);

    // --- 2. Enable Required APIs ---
    await enableProjectApis(serviceUsage, projectId);

    // --- 3. Add Firebase to the Project ---
    await addFirebase(firebase, projectId);

    // --- 4. Create CI/CD Service Account ---
    const saEmail = `github-deployer@${projectId}.iam.gserviceaccount.com`;
    await createServiceAccount(iam, projectId, saEmail);

    // --- 5. Grant IAM Roles to the new Service Account ---
    await grantRolesToServiceAccount(crm, projectId, saEmail);

    // --- 6. Set up Workload Identity Federation (WIF) ---
    const wifProviderName = await setupWif(iam, projectId, saEmail);

    log('gcp.provision.success', { projectId });
    return {
        projectId,
        projectNumber,
        serviceAccountEmail: saEmail,
        wifProviderName,
    };
}


// --- Helper Sub-functions ---

async function createProjectAndLinkBilling(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, displayName: string, folderId: string) {
    log('gcp.project.create.start', { projectId, parent: folderId });
    try {
        const createOp = await crm.projects.create({
            requestBody: { projectId, displayName, parent: `folders/${folderId}` },
        });
        await pollOperation(crm, createOp.data.name!);
        log('gcp.project.create.success', { projectId });
    } catch (error: any) {
        if (error.code === 409) {
            log('gcp.project.create.already_exists', { projectId });
        } else {
            throw error;
        }
    }

    log('gcp.billing.link.start', { projectId });
    const billing = google.cloudbilling({ version: 'v1', auth: await getAuth() });
    await billing.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: { billingAccountName: `billingAccounts/${BILLING_ACCOUNT_ID}` },
    });
    log('gcp.billing.link.success', { projectId });
}

async function getProjectNumber(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string): Promise<string> {
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber) throw new Error(`Could not retrieve project number for ${projectId}`);
    return projectNumber;
}

async function enableProjectApis(serviceUsage: serviceusage_v1.Serviceusage, projectId: string) {
    const apis = [
        'run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com',
        'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com',
        'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com',
        'serviceusage.googleapis.com', 'firebasehosting.googleapis.com'
    ];
    log('gcp.api.enable.start', { projectId, apis });
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({
        parent,
        requestBody: { serviceIds: apis },
    });
    await pollOperation(serviceUsage, enableOp.data.name!);
    log('gcp.api.enable.success', { projectId });
}

async function addFirebase(firebase: firebase_v1beta1.Firebase, projectId: string) {
    log('gcp.firebase.add.start', { projectId });
    try {
        await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        log('gcp.firebase.add.success', { projectId });
    } catch (error: any) {
        if (error.code === 409) {
            log('gcp.firebase.add.already_exists', { projectId });
        } else {
            throw error;
        }
    }

    const hosting = google.firebasehosting({ version: 'v1beta1', auth: await getAuth() });
    const maxRetries = 5;
    const delay = 10000; // 10 seconds

    for (let i = 0; i < maxRetries; i++) {
        try {
            log('gcp.firebase.hosting_site.create.attempt', { projectId, siteId: projectId, attempt: i + 1 });
            await hosting.projects.sites.create({
                parent: `projects/${projectId}`,
                siteId: projectId,
            });
            log('gcp.firebase.hosting_site.create.success', { projectId, siteId: projectId });
            return;
        } catch (error: any) {
            if (error.code === 409) {
                log('gcp.firebase.hosting_site.create.already_exists', { projectId, siteId: projectId });
                return;
            }
            log('gcp.firebase.hosting_site.create.error', { projectId, error: error.message, attempt: i + 1 });
            if (i === maxRetries - 1) {
                throw new Error(`Failed to create Firebase Hosting site for ${projectId} after ${maxRetries} attempts.`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


async function createServiceAccount(iam: iam_v1.Iam, projectId: string, saEmail: string) {
    log('gcp.sa.create.start', { saEmail });
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: {
                accountId: saEmail.split('@')[0],
                serviceAccount: { displayName: 'GitHub Actions Deployer' },
            },
        });
        log('gcp.sa.create.success', { saEmail });
        
        log('gcp.sa.create.propagating', { delay: 10000 });
        await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error: any) {
        if (error.code === 409) {
            log('gcp.sa.create.already_exists', { saEmail });
        } else {
            throw error;
        }
    }
}

async function grantRolesToServiceAccount(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, saEmail: string) {
    const roles = [
        'roles/run.admin', 'roles/artifactregistry.writer',
        'roles/firebase.admin', 'roles/iam.serviceAccountUser'
    ];
    log('gcp.iam.grant.start', { saEmail, roles });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    
    if (!policy.bindings) {
        policy.bindings = [];
    }

    roles.forEach(role => {
        let binding = policy.bindings!.find(b => b.role === role);
        if (binding) {
            if (!binding.members?.includes(`serviceAccount:${saEmail}`)) {
                 binding.members?.push(`serviceAccount:${saEmail}`);
            }
        } else {
            policy.bindings!.push({
                role,
                members: [`serviceAccount:${saEmail}`],
            });
        }
    });

    await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
    log('gcp.iam.grant.success', { saEmail });
}

async function setupWif(iam: iam_v1.Iam, newProjectId: string, saEmail: string): Promise<string> {
    if (!CP_PROJECT_NUMBER) {
        throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER environment variable is not set. This is required to find the central WIF pool.");
    }

    const controlPlaneProject = `projects/${CP_PROJECT_NUMBER}`;
    const poolId = 'github-pool'; // The central pool created by bootstrap
    const providerId = newProjectId; // Use the new project ID as the unique provider ID for idempotency
    const poolPath = `${controlPlaneProject}/locations/global/workloadIdentityPools/${poolId}`;

    log('gcp.wif.provider.create.start', { providerId, pool: poolPath });

    try {
        const repoCondition = `attribute.repository == '${GITHUB_OWNER}/${newProjectId}'`;
        await iam.projects.locations.workloadIdentityPools.providers.create({
            parent: poolPath,
            workloadIdentityPoolProviderId: providerId,
            requestBody: {
                displayName: `GitHub Provider for ${newProjectId}`,
                oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
                attributeMapping: {
                    'google.subject': 'assertion.sub',
                    'attribute.actor': 'assertion.actor',
                    'attribute.repository': 'assertion.repository',
                },
                attributeCondition: repoCondition,
            },
        });
        log('gcp.wif.provider.create.success', { providerId });
    } catch (error: any) {
        if (error.code !== 409) throw error;
        log('gcp.wif.provider.already_exists', { providerId });
    }

    log('gcp.wif.sa_binding.start', { saEmail, newProjectId });
    const saResource = `projects/${newProjectId}/serviceAccounts/${saEmail}`;
    const wifMember = `principalSet://iam.googleapis.com/${poolPath}/attribute.repository/${GITHUB_OWNER}/${newProjectId}`;
    const { data: saPolicy } = await iam.projects.serviceAccounts.getIamPolicy({ resource: saResource });
    
    if (!saPolicy.bindings) saPolicy.bindings = [];
    
    const role = 'roles/iam.workloadIdentityUser';
    let binding = saPolicy.bindings.find(b => b.role === role);
    let needsUpdate = false;
    if (binding) {
        if (!binding.members?.includes(wifMember)) {
            binding.members?.push(wifMember);
            needsUpdate = true;
        }
    } else {
        saPolicy.bindings.push({ role: role, members: [wifMember] });
        needsUpdate = true;
    }
    
    if (needsUpdate) {
        await iam.projects.serviceAccounts.setIamPolicy({
            resource: saResource,
            requestBody: { policy: saPolicy },
        });
        log('gcp.wif.sa_binding.updated', { saEmail });
    } else {
        log('gcp.wif.sa_binding.already_exists', { saEmail });
    }

    const providerName = `${poolPath}/providers/${providerId}`;
    log('gcp.wif.setup.success', { providerName });
    return providerName;
}


async function pollOperation(api: any, operationName: string, maxRetries = 20, delay = 5000) {
    let isDone = false;
    let retries = 0;
    while (!isDone && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const op = await api.operations.get({ name: operationName });
        isDone = op.data.done || false;
        retries++;
        log('gcp.operation.polling', { name: operationName, done: isDone, attempt: retries });
    }
    if (!isDone) {
        throw new Error(`Operation ${operationName} did not complete in time.`);
    }
}

export const { createGcpFolderForOrg, deleteGcpFolder, deleteGcpProject } = GcpLegacyService;

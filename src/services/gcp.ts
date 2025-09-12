// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/services/gcp.ts
// FINAL VERSION: Handles billing permission errors gracefully and adds robust retries for Firebase Hosting creation.

import { google, cloudresourcemanager_v3, iam_v1, serviceusage_v1, firebase_v1beta1, artifactregistry_v1 } from 'googleapis';
import { log, BillingError } from '../routes/projects'; // Import custom error
import * as GcpLegacyService from './gcp_legacy';

// Environment variables used by the service
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '';
const GCP_DEFAULT_REGION = process.env.GCP_DEFAULT_REGION || 'europe-west1';

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

export async function provisionProjectInfrastructure(projectId: string, displayName: string, folderId: string): Promise<ProvisionResult> {
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });
    const iam = google.iam({ version: 'v1', auth });
    const serviceUsage = google.serviceusage({ version: 'v1', auth });
    const firebase = google.firebase({ version: 'v1beta1', auth });

    log('gcp.provision.all.start', { projectId, displayName, parentFolder: folderId, region: GCP_DEFAULT_REGION });

    // This function can now throw a BillingError
    await createProjectAndLinkBilling(crm, projectId, displayName, folderId);
    
    const projectNumber = await getProjectNumber(crm, projectId);
    await enableProjectApis(serviceUsage, projectId);
    await createArtifactRegistryRepo(projectId, 'wizbi');
    await addFirebase(firebase, projectId);
    
    // This SA is for the CI/CD pipeline inside the new project.
    const saEmail = `github-deployer@${projectId}.iam.gserviceaccount.com`;
    await createServiceAccount(iam, projectId, saEmail);
    await grantRolesToServiceAccount(crm, projectId, saEmail);
    const wifProviderName = await setupWif(iam, projectId, saEmail);

    log('gcp.provision.all.success', { projectId, projectNumber, finalSa: saEmail });
    return {
        projectId,
        projectNumber,
        serviceAccountEmail: saEmail,
        wifProviderName,
    };
}

// --- Helper Sub-functions ---

async function createProjectAndLinkBilling(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, displayName: string, folderId: string) {
    log('gcp.project.create.attempt', { projectId, displayName, parent: `folders/${folderId}` });
    try {
        const createOp = await crm.projects.create({
            requestBody: { projectId, displayName, parent: `folders/${folderId}` },
        });
        log('gcp.project.create.operation_sent', { operationName: createOp.data.name });
        await pollOperation(crm.operations, createOp.data.name!);
        log('gcp.project.create.operation_success', { projectId });
    } catch (error: any) {
        if (error.code === 409) {
            log('gcp.project.create.already_exists', { projectId });
        } else {
            log('gcp.project.create.error', { projectId, error: error.message });
            throw error;
        }
    }

    const billing = google.cloudbilling({ version: 'v1', auth: await getAuth() });
    
    log('gcp.billing.iam_propagation_delay', { delay: 30000 });
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
        log('gcp.billing.link.attempt', { projectId, billingAccount: BILLING_ACCOUNT_ID });
        await billing.projects.updateBillingInfo({
            name: `projects/${projectId}`,
            requestBody: { billingAccountName: `billingAccounts/${BILLING_ACCOUNT_ID}` },
        });
        log('gcp.billing.link.success', { projectId });
    } catch (error: any) {
        if (error.message && error.message.includes('The caller does not have permission')) {
            log('gcp.billing.link.permission_denied_throwing_billing_error', { projectId, error: error.message });
            throw new BillingError(error.message, projectId);
        }
        log('gcp.billing.link.fatal_error', { projectId, error: error.message });
        throw error;
    }
}


async function getProjectNumber(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string): Promise<string> {
    log('gcp.project.number.get', { projectId });
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber) {
        log('gcp.project.number.error', { projectId });
        throw new Error(`Could not retrieve project number for ${projectId}`);
    }
    log('gcp.project.number.success', { projectId, projectNumber });
    return projectNumber;
}

async function enableProjectApis(serviceUsage: serviceusage_v1.Serviceusage, projectId: string) {
    const apis = [
        'run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com',
        'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com',
        'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com',
        'serviceusage.googleapis.com', 'firebasehosting.googleapis.com', 'aiplatform.googleapis.com' // Added Vertex AI
    ];
    log('gcp.api.enable.attempt', { projectId, apis });
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({
        parent,
        requestBody: { serviceIds: apis },
    });
    log('gcp.api.enable.operation_sent', { operationName: enableOp.data.name });
    await pollOperation(serviceUsage.operations, enableOp.data.name!);
    log('gcp.api.enable.operation_success', { projectId, count: apis.length });
}

async function createArtifactRegistryRepo(projectId: string, repoId: string) {
    log('gcp.ar.repo.create.attempt', { projectId, repoId, region: GCP_DEFAULT_REGION });
    const auth = await getAuth();
    const artifactRegistry = google.artifactregistry({ version: 'v1', auth });
    const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const createOp = await artifactRegistry.projects.locations.repositories.create({
                parent,
                repositoryId: repoId,
                requestBody: { format: 'DOCKER', description: 'WIZBI project containers' },
            });
            log('gcp.ar.repo.create.operation_sent', { operationName: createOp.data.name });
            await pollOperation(artifactRegistry.projects.locations.operations, createOp.data.name!);
            log('gcp.ar.repo.create.operation_success', { repoId });
            return;
        } catch (error: any) {
            if (error.code === 409) {
                log('gcp.ar.repo.create.already_exists', { repoId });
                return;
            }
            if (error.code === 403 && attempt < 5) {
                const delay = 10000 * attempt;
                log('gcp.ar.repo.create.permission_denied_retrying', { attempt, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                log('gcp.ar.repo.create.fatal_error', { projectId, error: error.message });
                throw error;
            }
        }
    }
}


// --- THIS IS THE MODIFIED FUNCTION ---
async function addFirebase(firebase: firebase_v1beta1.Firebase, projectId: string) {
    log('gcp.firebase.add.attempt', { projectId });
    try {
        const op = await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        log('gcp.firebase.add.success', { projectId, operationName: op.data.name });
    } catch (error: any) {
        if (error.code === 409) log('gcp.firebase.add.already_exists', { projectId });
        else {
            log('gcp.firebase.add.error', { projectId, error: error.message });
            throw error;
        }
    }
    
    // **FIX 1: Add a delay to allow Firebase services to propagate.**
    const propagationDelay = 15000; // 15 seconds
    log('gcp.firebase.propagation_delay.start', { delay: propagationDelay });
    await new Promise(resolve => setTimeout(resolve, propagationDelay));
    log('gcp.firebase.propagation_delay.end');

    const hosting = google.firebasehosting({ version: 'v1beta1', auth: await getAuth() });
    
    // **FIX 2: Wrap both site creation calls in the robust retry logic.**
    await createDefaultHostingSite(hosting, projectId);
    await createHostingSite(hosting, projectId, `${projectId}-qa`);
}

// **FIX 2 (cont.): Create a more robust version of this function with retries.**
async function createDefaultHostingSite(hosting: any, projectId: string) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            log('gcp.firebase.hosting.create_default.attempt', { projectId, attempt });
            await hosting.projects.sites.create({ parent: `projects/${projectId}` });
            log('gcp.firebase.hosting.create_default.success', { projectId });
            return; // Success, exit the loop
        } catch (error: any) {
            if (error.code === 409) {
                log('gcp.firebase.hosting.create_default.already_exists', { projectId });
                return; // Already exists, exit the loop
            }
            if (attempt < 5) {
                const delay = 10000 * attempt;
                log('gcp.firebase.hosting.create_default.error_retrying', { error: error.message, attempt, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 log('gcp.firebase.hosting.create_default.fatal_error', { projectId, error: error.message });
                 // Decide if you want to throw an error here or just log it. For now, we log.
            }
        }
    }
}

async function createHostingSite(hosting: any, projectId: string, siteId: string) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            log('gcp.firebase.hosting.create.attempt', { projectId, siteId, attempt });
            await hosting.projects.sites.create({ parent: `projects/${projectId}`, siteId: siteId });
            log('gcp.firebase.hosting.create.success', { projectId, siteId });
            return;
        } catch (error: any)
        {
            if (error.code === 409) {
                log('gcp.firebase.hosting.create.already_exists', { projectId, siteId });
                return;
            }
            if (attempt < 5) {
                const delay = 10000 * attempt;
                log('gcp.firebase.hosting.create.error_retrying', { siteId, error: error.message, attempt, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                  throw new Error(`Failed to create Firebase Hosting site ${siteId} after 5 attempts.`);
            }
        }
    }
}

async function createServiceAccount(iam: iam_v1.Iam, projectId: string, saEmail: string) {
    const accountId = saEmail.split('@')[0];
    log('gcp.sa.create.attempt', { projectId, accountId, displayName: 'GitHub Actions Deployer' });
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'GitHub Actions Deployer' } },
        });
        log('gcp.sa.create.success', { saEmail });
        log('gcp.sa.iam.propagating', { delay: 15000 });
        await new Promise(resolve => setTimeout(resolve, 15000));
    } catch (error: any) {
        if (error.code === 409) log('gcp.sa.create.already_exists', { saEmail });
        else {
             log('gcp.sa.create.error', { saEmail, error: error.message });
             throw error;
        }
    }
}

async function grantRolesToServiceAccount(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, saEmail: string) {
    const roles = [
        'roles/run.admin', 
        'roles/artifactregistry.writer', 
        'roles/firebase.admin', 
        'roles/iam.serviceAccountUser',
        'roles/serviceusage.serviceUsageAdmin',
        'roles/aiplatform.user'
    ];
    
    log('gcp.iam.grant.attempt', { saEmail, roles });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    
    if (!policy.bindings) policy.bindings = [];
    let updated = false;

    roles.forEach(role => {
        let binding = policy.bindings!.find(b => b.role === role);
        const member = `serviceAccount:${saEmail}`;
        if (binding) {
            if (!binding.members?.includes(member)) {
                 binding.members?.push(member);
                 updated = true;
            }
        } else {
            policy.bindings!.push({ role, members: [member] });
            updated = true;
        }
    });

    if (updated) {
        await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
        log('gcp.iam.grant.success', { saEmail, roles_granted_count: roles.length });
    } else {
        log('gcp.iam.grant.already_exists', { saEmail, roles });
    }
}

async function setupWif(iam: iam_v1.Iam, newProjectId: string, saEmail: string): Promise<string> {
    if (!CP_PROJECT_NUMBER) throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER env var is not set.");

    const controlPlaneProject = `projects/${CP_PROJECT_NUMBER}`;
    const poolId = 'github-pool';
    const providerId = newProjectId;
    const poolPath = `${controlPlaneProject}/locations/global/workloadIdentityPools/${poolId}`;
    const attributeCondition = `attribute.repository == '${GITHUB_OWNER}/${newProjectId}'`;

    log('gcp.wif.provider.create.attempt', { controlPlaneProject, poolId, providerId, attributeCondition });
    try {
        await iam.projects.locations.workloadIdentityPools.providers.create({
            parent: poolPath,
            workloadIdentityPoolProviderId: providerId,
            requestBody: {
                displayName: `GH-${newProjectId}`.substring(0, 32),
                oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
                attributeMapping: { 'google.subject': 'assertion.sub', 'attribute.repository': 'assertion.repository' },
                attributeCondition,
            },
        });
        log('gcp.wif.provider.create.success', { providerId });
    } catch (error: any) {
        if (error.code !== 409) {
             log('gcp.wif.provider.create.error', { providerId, error: error.message });
             throw error;
        }
        log('gcp.wif.provider.already_exists', { providerId });
    }

    log('gcp.wif.binding.attempt', { saEmail, newProjectId });
    const saResource = `projects/${newProjectId}/serviceAccounts/${saEmail}`;
    const wifMember = `principalSet://iam.googleapis.com/${poolPath}/attribute.repository/${GITHUB_OWNER}/${newProjectId}`;
    const { data: saPolicy } = await iam.projects.serviceAccounts.getIamPolicy({ resource: saResource });
    
    if (!saPolicy.bindings) saPolicy.bindings = [];
    
    const role = 'roles/iam.workloadIdentityUser';
    let binding = saPolicy.bindings.find(b => b.role === role);
    if (!binding || !binding.members?.includes(wifMember)) {
        log('gcp.wif.binding.updating_policy', { role, wifMember });
        saPolicy.bindings = (saPolicy.bindings || []).filter(b => b.role !== role);
        saPolicy.bindings.push({ role, members: [...(binding?.members || []), wifMember].filter((v, i, a) => a.indexOf(v) === i) });
        await iam.projects.serviceAccounts.setIamPolicy({ resource: saResource, requestBody: { policy: saPolicy } });
        log('gcp.wif.binding.updated', { saEmail });
    } else {
        log('gcp.wif.binding.already_exists', { saEmail });
    }

    const providerName = `${poolPath}/providers/${providerId}`;
    log('gcp.wif.setup.success', { providerName });
    return providerName;
}

async function pollOperation(operationsClient: any, operationName: string, maxRetries = 20, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const op = await operationsClient.get({ name: operationName });
        if (op.data.done) {
            log('gcp.operation.polling.success', { name: operationName, attempt });
            return;
        }
        log('gcp.operation.polling.in_progress', { name: operationName, attempt });
    }
    throw new Error(`Operation ${operationName} did not complete in time.`);
}

export const { createGcpFolderForOrg, deleteGcpFolder, deleteGcpProject } = GcpLegacyService;

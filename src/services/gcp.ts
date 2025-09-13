// --- FINALIZED AND COMBINED VERSION ---
// File path: src/services/gcp.ts
// Implements a proactive, deterministic Service Account creation AND robust, multi-site Firebase Hosting setup.

import { google } from 'googleapis';
import type { cloudresourcemanager_v3, iam_v1, serviceusage_v1, firebase_v1beta1, firebasehosting_v1beta1 } from 'googleapis';
import { log, BillingError } from '../routes/projects';
import * as GcpLegacyService from './gcp_legacy';

// Environment variables
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '';
const GCP_DEFAULT_REGION = process.env.GCP_DEFAULT_REGION || 'europe-west1';

async function getAuth() {
    return google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

export interface ProvisionResult {
    projectId: string;
    projectNumber: string;
    serviceAccountEmail: string;
    wifProviderName: string;
}

export async function provisionProjectInfrastructure(projectId: string, displayName: string, folderId: string): Promise<ProvisionResult> {
    log('gcp.provision.all.start', { projectId, displayName, parentFolder: folderId, region: GCP_DEFAULT_REGION });
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });
    const iam = google.iam({ version: 'v1', auth });
    const serviceUsage = google.serviceusage({ version: 'v1', auth });
    const firebase = google.firebase({ version: 'v1beta1', auth });
    const firebasehosting = google.firebasehosting({ version: 'v1beta1', auth });

    await createProjectAndLinkBilling(crm, projectId, displayName, folderId);
    
    const projectNumber = await getProjectNumber(crm, projectId);
    await enableProjectApis(serviceUsage, projectId);
    await createArtifactRegistryRepo(projectId, 'wizbi');
    
    // --- Firebase Provisioning Sequence ---
    await addFirebase(firebase, projectId);
    await createFirebaseHostingSites(firebasehosting, projectId); // Create sites (PROD + QA) with retry logic.
    await createFirebaseInvokerSA(iam, crm, projectId); // Create our own SA instead of waiting for Google's.
    
    const saEmail = `github-deployer@${projectId}.iam.gserviceaccount.com`;
    await createServiceAccount(iam, projectId, saEmail);
    await grantRolesToServiceAccount(crm, projectId, saEmail);
    const wifProviderName = await setupWif(iam, projectId, saEmail);

    log('gcp.provision.all.success', { projectId, projectNumber, finalSa: saEmail });
    return { projectId, projectNumber, serviceAccountEmail: saEmail, wifProviderName };
}

async function createProjectAndLinkBilling(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, displayName: string, folderId: string) {
    log('gcp.project.create.attempt', { projectId, displayName, parent: `folders/${folderId}` });
    try {
        const createOp = await crm.projects.create({ requestBody: { projectId, displayName, parent: `folders/${folderId}` } });
        log('gcp.project.create.operation_sent', { operationName: createOp.data.name });
        await pollOperation(crm.operations, createOp.data.name!);
        log('gcp.project.create.operation_success', { projectId });
    } catch (error: any) {
        if (error.code === 409) log('gcp.project.create.already_exists', { projectId });
        else {
            log('gcp.project.create.error', { projectId, error: error.message, stack: error.stack });
            throw error;
        }
    }

    const billing = google.cloudbilling({ version: 'v1', auth: await getAuth() });
    const delay = 30000;
    log('gcp.billing.iam_propagation_delay.start', { delay });
    await new Promise(resolve => setTimeout(resolve, delay));
    log('gcp.billing.iam_propagation_delay.end');

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
        log('gcp.billing.link.fatal_error', { projectId, error: error.message, stack: error.stack });
        throw error;
    }
}

async function getProjectNumber(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string): Promise<string> {
    log('gcp.project.number.get.attempt', { projectId });
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber) {
        log('gcp.project.number.error.not_found', { projectId, apiResponse: project.data });
        throw new Error(`Could not retrieve project number for ${projectId}`);
    }
    log('gcp.project.number.get.success', { projectId, projectNumber });
    return projectNumber;
}

async function enableProjectApis(serviceUsage: serviceusage_v1.Serviceusage, projectId: string) {
    const apis = [
        'run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com',
        'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com',
        'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com',
        'serviceusage.googleapis.com', 'firebasehosting.googleapis.com', 'aiplatform.googleapis.com'
    ];
    log('gcp.api.enable.attempt', { projectId, apisToEnable: apis });
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({ parent, requestBody: { serviceIds: apis } });
    log('gcp.api.enable.operation_sent', { operationName: enableOp.data.name });
    await pollOperation(serviceUsage.operations, enableOp.data.name!);
    log('gcp.api.enable.operation_success', { projectId, count: apis.length });
}

async function createArtifactRegistryRepo(projectId: string, repoId: string) {
    log('gcp.ar.repo.create.start', { projectId, repoId, region: GCP_DEFAULT_REGION });
    const auth = await getAuth();
    const artifactRegistry = google.artifactregistry({ version: 'v1', auth });
    const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        log('gcp.ar.repo.create.attempt', { attempt, maxAttempts: 5 });
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
                log('gcp.ar.repo.create.permission_denied_retrying', { attempt, delay, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                log('gcp.ar.repo.create.fatal_error', { projectId, error: error.message, stack: error.stack });
                throw error;
            }
        }
    }
}

async function addFirebase(firebase: firebase_v1beta1.Firebase, projectId: string) {
    log('gcp.firebase.add.start', { projectId });
    try {
        const op = await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        log('gcp.firebase.add.operation_sent', { projectId, operationName: op.data.name });
        // Although this returns an operation, we let the retry logic in site creation handle the timing.
    } catch (error: any) {
        if (error.code === 409) log('gcp.firebase.add.already_exists', { projectId });
        else {
            log('gcp.firebase.add.fatal_error', { projectId, error: error.message, stack: error.stack });
            throw error;
        }
    }
}

async function createFirebaseHostingSites(hosting: firebasehosting_v1beta1.Firebasehosting, projectId: string) {
    const qaSiteId = `${projectId}-qa`;
    
    // Helper function with retry logic to handle the race condition
    const createSiteWithRetry = async (siteIdToCreate?: string) => {
        const targetSite = siteIdToCreate || projectId; // Use projectId for default site logging
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                log('gcp.firebase.hosting.create.attempt', { projectId, siteId: targetSite, attempt });
                await hosting.projects.sites.create({
                    parent: `projects/${projectId}`,
                    siteId: siteIdToCreate, // Will be undefined for default, which is correct
                });
                log('gcp.firebase.hosting.create.success', { projectId, siteId: targetSite });
                return; // Exit on success
            } catch (error: any) {
                if (error.code === 409) {
                    log('gcp.firebase.hosting.create.already_exists', { projectId, siteId: targetSite });
                    return; // Exit if already exists
                }
                if (attempt < 5) {
                    const delay = 5000 * attempt;
                    log('gcp.firebase.hosting.create.error_retrying', { siteId: targetSite, error: error.message, attempt, delay });
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    log('gcp.firebase.hosting.create.fatal_error', { projectId, siteId: targetSite, error: error.message });
                    throw new Error(`Failed to create Firebase Hosting site ${targetSite} after 5 attempts.`);
                }
            }
        }
    };

    // Create both sites using the robust helper
    await createSiteWithRetry(); // Create default site
    await createSiteWithRetry(qaSiteId); // Create QA site
}

async function createFirebaseInvokerSA(iam: iam_v1.Iam, crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string): Promise<string> {
    const accountId = 'firebase-hosting-invoker';
    const saEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`;
    log('gcp.sa.invoker.create.attempt', { projectId, accountId });

    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'Firebase Hosting to Cloud Run Invoker' } },
        });
        log('gcp.sa.invoker.create.success', { saEmail });
    } catch (error: any) {
        if (error.code === 409) {
            log('gcp.sa.invoker.create.already_exists', { saEmail });
        } else {
            log('gcp.sa.invoker.create.fatal_error', { saEmail, error: error.message });
            throw error;
        }
    }
    
    const delay = 10000;
    log('gcp.sa.invoker.iam_propagation_delay.start', { delay });
    await new Promise(resolve => setTimeout(resolve, delay));
    log('gcp.sa.invoker.iam_propagation_delay.end');

    log('gcp.iam.grant.invoker_role.attempt', { saEmail });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    const role = 'roles/run.invoker';
    const member = `serviceAccount:${saEmail}`;
    
    let binding = policy.bindings?.find((b: any) => b.role === role);
    if (!binding) {
        binding = { role, members: [] };
        if (!policy.bindings) policy.bindings = [];
        policy.bindings.push(binding);
    }
    if (!binding.members?.includes(member)) {
        binding.members?.push(member);
        await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
        log('gcp.iam.grant.invoker_role.success', { saEmail });
    } else {
        log('gcp.iam.grant.invoker_role.already_granted', { saEmail });
    }
    
    return saEmail;
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
        const delay = 15000;
        log('gcp.sa.iam_propagation_delay.start', { delay, reason: "Allowing SA to be available for IAM policy bindings." });
        await new Promise(resolve => setTimeout(resolve, delay));
        log('gcp.sa.iam_propagation_delay.end');
    } catch (error: any) {
        if (error.code === 409) log('gcp.sa.create.already_exists', { saEmail });
        else {
             log('gcp.sa.create.fatal_error', { saEmail, error: error.message, stack: error.stack });
             throw error;
        }
    }
}

async function grantRolesToServiceAccount(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, saEmail: string) {
    const roles = [
        'roles/run.admin', 'roles/artifactregistry.writer', 'roles/firebase.admin', 
        'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageAdmin', 'roles/aiplatform.user'
    ];
    log('gcp.iam.grant.start', { saEmail, rolesToGrant: roles });
    const resource = `projects/${projectId}`;
    log('gcp.iam.grant.get_policy.attempt');
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    log('gcp.iam.grant.get_policy.success');
    if (!policy.bindings) policy.bindings = [];
    let needsUpdate = false;
    roles.forEach(role => {
        const member = `serviceAccount:${saEmail}`;
        let binding = policy.bindings!.find((b: any) => b.role === role);
        if (binding) {
            if (!binding.members?.includes(member)) {
                 log('gcp.iam.grant.adding_member_to_existing_role', { member, role });
                 binding.members?.push(member);
                 needsUpdate = true;
            } else {
                 log('gcp.iam.grant.member_already_exists_in_role', { member, role });
            }
        } else {
            log('gcp.iam.grant.creating_new_binding_for_role', { member, role });
            policy.bindings!.push({ role, members: [member] });
            needsUpdate = true;
        }
    });
    if (needsUpdate) {
        log('gcp.iam.grant.set_policy.attempt');
        await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
        log('gcp.iam.grant.set_policy.success', { saEmail, roles_granted_count: roles.length });
    } else {
        log('gcp.iam.grant.no_update_needed', { saEmail });
    }
}

async function setupWif(iam: iam_v1.Iam, newProjectId: string, saEmail: string): Promise<string> {
    if (!CP_PROJECT_NUMBER) {
        log('gcp.wif.setup.error.missing_env_var');
        throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER env var is not set.");
    }
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
             log('gcp.wif.provider.create.fatal_error', { providerId, error: error.message, stack: error.stack });
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
    let binding = saPolicy.bindings.find((b: any) => b.role === role);
    if (!binding || !binding.members?.includes(wifMember)) {
        log('gcp.wif.binding.updating_policy', { role, wifMember });
        const existingMembers = binding?.members || [];
        saPolicy.bindings = (saPolicy.bindings || []).filter((b: any) => b.role !== role);
        saPolicy.bindings.push({ role, members: [...existingMembers, wifMember].filter((v, i, a) => a.indexOf(v) === i) });
        await iam.projects.serviceAccounts.setIamPolicy({ resource: saResource, requestBody: { policy: saPolicy } });
        log('gcp.wif.binding.update.success', { saEmail });
    } else {
        log('gcp.wif.binding.already_exists', { saEmail });
    }
    const providerName = `${poolPath}/providers/${providerId}`;
    log('gcp.wif.setup.success', { providerName });
    return providerName;
}

async function pollOperation(operationsClient: any, operationName: string, maxRetries = 20, delay = 5000) {
    log('gcp.operation.polling.start', { name: operationName, maxRetries, delay });
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const op = await operationsClient.get({ name: operationName });
        if (op.data.done) {
            if(op.data.error) {
                log('gcp.operation.polling.error', { name: operationName, attempt, error: op.data.error });
                throw new Error(`Operation ${operationName} failed with error: ${JSON.stringify(op.data.error)}`);
            }
            log('gcp.operation.polling.success', { name: operationName, attempt });
            return;
        }
        log('gcp.operation.polling.in_progress', { name: operationName, attempt });
    }
    log('gcp.operation.polling.timeout_error', { name: operationName });
    throw new Error(`Operation ${operationName} did not complete in time.`);
}

export const { createGcpFolderForOrg, deleteGcpFolder, deleteGcpProject } = GcpLegacyService;

// --- FINAL VERSION: Corrected API call signatures and polling logic ---
// File path: src/services/gcp.ts

import { google } from 'googleapis';
import type { cloudresourcemanager_v3, iam_v1, serviceusage_v1, firebase_v1beta1, firebasehosting_v1beta1, run_v1 } from 'googleapis';
import { log, BillingError } from '../routes/projects';
import * as GcpLegacyService from './gcp_legacy';
import crypto from 'crypto';
import https from 'https';


// Environment variables
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '';
const GCP_DEFAULT_REGION = process.env.GCP_DEFAULT_REGION || 'europe-west1';
const PLACEHOLDER_IMAGE = 'gcr.io/cloudrun/hello'; // Public placeholder image

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
    const cloudrun = google.run({ version: 'v1', auth });

    await createProjectAndLinkBilling(crm, projectId, displayName, folderId);
    
    const projectNumber = await getProjectNumber(crm, projectId);
    await enableProjectApis(serviceUsage, projectId);
    await createArtifactRegistryRepo(projectId, 'wizbi');
    
    // --- Full Deterministic Flow ---
    await addFirebase(firebase, projectId);
    await createFirebaseInvokerSA(iam, crm, projectId);
    
    // Deploy placeholder services to make them live immediately
    await deployPlaceholderCloudRunServices(cloudrun, projectId);
    await createAndReleaseHostingVersions(firebasehosting, projectId);
    
    const deployerSaEmail = `github-deployer@${projectId}.iam.gserviceaccount.com`;
    await createServiceAccount(iam, projectId, deployerSaEmail);
    await grantRolesToServiceAccount(crm, projectId, deployerSaEmail);
    const wifProviderName = await setupWif(iam, projectId, deployerSaEmail);

    log('gcp.provision.all.success', { projectId, projectNumber, finalSa: deployerSaEmail });
    return { projectId, projectNumber, serviceAccountEmail: deployerSaEmail, wifProviderName };
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
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber) throw new Error(`Could not retrieve project number for ${projectId}`);
    return projectNumber;
}

async function enableProjectApis(serviceUsage: serviceusage_v1.Serviceusage, projectId: string) {
    const apis = [ 'run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com', 'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com', 'serviceusage.googleapis.com', 'firebasehosting.googleapis.com', 'aiplatform.googleapis.com' ];
    log('gcp.api.enable.attempt', { projectId, apisToEnable: apis.length });
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({ parent, requestBody: { serviceIds: apis } });
    await pollOperation(serviceUsage.operations, enableOp.data.name!);
    log('gcp.api.enable.operation_success', { projectId });
}

async function createArtifactRegistryRepo(projectId: string, repoId: string) {
    log('gcp.ar.repo.create.start', { projectId, repoId });
    const auth = await getAuth();
    const artifactRegistry = google.artifactregistry({ version: 'v1', auth });
    const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;
    try {
        const createOp = await artifactRegistry.projects.locations.repositories.create({
            parent,
            repositoryId: repoId,
            requestBody: { format: 'DOCKER' },
        });
        await pollOperation(artifactRegistry.projects.locations.operations, createOp.data.name!);
        log('gcp.ar.repo.create.success', { repoId });
    } catch (error: any) {
        if (error.code === 409) log('gcp.ar.repo.create.already_exists', { repoId });
        else throw error;
    }
}

async function addFirebase(firebase: firebase_v1beta1.Firebase, projectId: string) {
    log('gcp.firebase.add.start', { projectId });
    try {
        const op = await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        log('gcp.firebase.add.api_call_sent', { projectId, opName: op.data.name });
        await pollOperation(firebase.operations, op.data.name!);

    } catch (error: any) {
        if (error.code === 409) log('gcp.firebase.add.already_exists', { projectId });
        else throw error;
    }
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
        if (error.code !== 409) throw error;
        log('gcp.sa.invoker.create.already_exists', { saEmail });
    }
    
    await new Promise(resolve => setTimeout(resolve, 10000)); // IAM propagation delay

    log('gcp.iam.grant.invoker_role.attempt', { saEmail });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    const role = 'roles/run.invoker';
    const member = `serviceAccount:${saEmail}`;
    
    if (!policy.bindings) policy.bindings = [];
    let binding = policy.bindings.find(b => b.role === role);
    if (!binding) {
        binding = { role, members: [] };
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

async function deployPlaceholderCloudRunServices(cloudrun: run_v1.Run, projectId: string) {
    const servicesToDeploy = [
        { name: projectId, isDefault: true },
        { name: `${projectId}-qa`, isDefault: false }
    ];
    for (const service of servicesToDeploy) {
        log('gcp.cloudrun.deploy.placeholder.start', { serviceName: service.name, image: PLACEHOLDER_IMAGE });
        const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;
        try {
            await cloudrun.projects.locations.services.create({
                parent: parent,
                requestBody: {
                    apiVersion: 'serving.knative.dev/v1',
                    kind: 'Service',
                    metadata: { name: service.name },
                    spec: {
                        template: {
                            spec: { containers: [{ image: PLACEHOLDER_IMAGE }] },
                        },
                    },
                },
            });
            await cloudrun.projects.locations.services.setIamPolicy({
                resource: `${parent}/services/${service.name}`,
                requestBody: {
                    policy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] }
                }
            });
            log('gcp.cloudrun.deploy.placeholder.success', { serviceName: service.name });
        } catch (error: any) {
            if (error.code === 409) log('gcp.cloudrun.deploy.placeholder.already_exists', { serviceName: service.name });
            else {
                log('gcp.cloudrun.deploy.placeholder.error', { serviceName: service.name, error: error.message });
                throw error;
            }
        }
    }
}

async function createAndReleaseHostingVersions(hosting: firebasehosting_v1beta1.Firebasehosting, projectId: string) {
    const sitesToCreate = [
        { id: projectId, isDefault: true },
        { id: `${projectId}-qa`, isDefault: false }
    ];
    const placeholderHtmlContent = '<!DOCTYPE html><html><body><h1>🚀 Coming Soon</h1></body></html>';
    const placeholderHtmlBuffer = Buffer.from(placeholderHtmlContent);
    const placeholderHtmlHash = crypto.createHash('sha256').update(placeholderHtmlBuffer).digest('hex');

    for (const site of sitesToCreate) {
        // No need to wait here, we will retry the versioning call instead
        try {
            log('gcp.firebase.hosting.create.attempt', { siteId: site.id });
            await hosting.projects.sites.create({ parent: `projects/${projectId}`, siteId: site.id });
            log('gcp.firebase.hosting.create.success', { siteId: site.id });
        } catch (error: any) {
            if (error.code !== 409) throw error;
            log('gcp.firebase.hosting.create.already_exists', { siteId: site.id });
        }
    }

    for (const site of sitesToCreate) {
        log('gcp.firebase.hosting.release.start', { siteId: site.id });
        const parent = `projects/${projectId}/sites/${site.id}`;
        
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 10000; // 10 seconds

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const { data: version } = await hosting.projects.sites.versions.create({
                    parent,
                    requestBody: {
                        config: { rewrites: [{ glob: '**', run: { serviceId: site.id, region: GCP_DEFAULT_REGION } }] }
                    }
                });
                const versionName = version.name!;
                
                const { data: populateData } = await hosting.projects.sites.versions.populateFiles({
                    parent: versionName,
                    requestBody: { files: { '/index.html': placeholderHtmlHash } },
                });

                if (populateData.uploadRequired && populateData.uploadUrl) {
                    await new Promise((resolve, reject) => {
                        const req = https.request(populateData.uploadUrl!, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/octet-stream',
                                'Content-Length': placeholderHtmlBuffer.length,
                                'x-goog-hash': `sha256=${placeholderHtmlHash}`,
                            },
                        }, (res) => {
                            if (res.statusCode === 200) {
                                resolve(res);
                            } else {
                                reject(new Error(`File upload failed with status ${res.statusCode}`));
                            }
                        });
                        req.on('error', reject);
                        req.write(placeholderHtmlBuffer);
                        req.end();
                    });
                }

                await hosting.projects.sites.versions.patch({
                    name: versionName,
                    updateMask: { paths: ['status'] },
                    requestBody: { status: 'FINALIZED' }
                });

                await hosting.projects.sites.releases.create({
                    parent: parent,
                    versionName: versionName, 
                    requestBody: { 
                        message: 'Initial Provisioning',
                    }
                });
                log('gcp.firebase.hosting.release.success', { siteId: site.id, attempt });
                break; // Success, exit retry loop
            } catch (error: any) {
                 log('gcp.firebase.hosting.release.error_attempt', { siteId: site.id, attempt, maxAttempts: MAX_RETRIES, error: error.message });
                 if ((error.code === 404 || error.message.includes("not found")) && attempt < MAX_RETRIES) {
                     await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt)); // Exponential backoff
                 } else {
                     // If it's not a recoverable error or we've run out of retries, throw the error
                     throw error;
                 }
            }
        }
    }
}


async function createServiceAccount(iam: iam_v1.Iam, projectId: string, saEmail: string) {
    const accountId = saEmail.split('@')[0];
    log('gcp.sa.create.attempt', { projectId, accountId });
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'GitHub Actions Deployer' } },
        });
        log('gcp.sa.create.success', { saEmail });
        await new Promise(resolve => setTimeout(resolve, 15000));
    } catch (error: any) {
        if (error.code !== 409) throw error;
        log('gcp.sa.create.already_exists', { saEmail });
    }
}

async function grantRolesToServiceAccount(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, saEmail: string) {
    const roles = [ 'roles/run.admin', 'roles/artifactregistry.writer', 'roles/firebase.admin', 'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageAdmin', 'roles/aiplatform.user' ];
    log('gcp.iam.grant.start', { saEmail, rolesToGrant: roles.length });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    if (!policy.bindings) policy.bindings = [];
    let needsUpdate = false;
    roles.forEach(role => {
        const member = `serviceAccount:${saEmail}`;
        let binding = policy.bindings!.find(b => b.role === role);
        if (binding) {
            if (!binding.members?.includes(member)) {
                 binding.members?.push(member);
                 needsUpdate = true;
            }
        } else {
            policy.bindings!.push({ role, members: [member] });
            needsUpdate = true;
        }
    });
    if (needsUpdate) {
        await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
        log('gcp.iam.grant.set_policy.success', { saEmail });
    } else {
        log('gcp.iam.grant.no_update_needed', { saEmail });
    }
}

async function setupWif(iam: iam_v1.Iam, newProjectId: string, saEmail: string): Promise<string> {
    if (!CP_PROJECT_NUMBER) throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER env var is not set.");
    
    const controlPlaneProject = `projects/${CP_PROJECT_NUMBER}`;
    const poolId = 'github-pool';
    const providerId = newProjectId;
    const poolPath = `${controlPlaneProject}/locations/global/workloadIdentityPools/${poolId}`;
    const attributeCondition = `attribute.repository == '${GITHUB_OWNER}/${newProjectId}'`;
    log('gcp.wif.provider.create.attempt', { providerId });

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
        if (error.code !== 409) throw error;
        log('gcp.wif.provider.already_exists', { providerId });
    }
    
    log('gcp.wif.binding.attempt', { saEmail, newProjectId });
    const saResource = `projects/${newProjectId}/serviceAccounts/${saEmail}`;
    const wifMember = `principalSet://iam.googleapis.com/${poolPath}/attribute.repository/${GITHUB_OWNER}/${newProjectId}`;
    const { data: saPolicy } = await iam.projects.serviceAccounts.getIamPolicy({ resource: saResource });
    const role = 'roles/iam.workloadIdentityUser';
    if (!saPolicy.bindings) saPolicy.bindings = [];
    let binding = saPolicy.bindings.find(b => b.role === role);
    if (!binding || !binding.members?.includes(wifMember)) {
        const existingMembers = binding?.members || [];
        saPolicy.bindings = saPolicy.bindings.filter(b => b.role !== role);
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
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const op = await operationsClient.get({ name: operationName });
        if (op.data.done) {
            if (op.data.error) {
                 log('gcp.operation.polling.error', { name: operationName, error: op.data.error });
                 throw new Error(`Operation ${operationName} failed: ${op.data.error.message}`);
            }
            log('gcp.operation.polling.success', { name: operationName, attempt: i + 1 });
            return;
        }
        log('gcp.operation.polling.in_progress', { name: operationName, attempt: i + 1 });
    }
    log('gcp.operation.polling.timeout_error', { name: operationName });
    throw new Error(`Operation ${operationName} timed out.`);
}

export const { createGcpFolderForOrg, deleteGcpFolder, deleteGcpProject } = GcpLegacyService;

// --- FINAL, FULLY AUTOMATED VERSION ---
// File path: src/services/gcp.ts

import { google } from 'googleapis';
import type { cloudresourcemanager_v3, iam_v1, serviceusage_v1, firebase_v1beta1, firebasehosting_v1beta1, run_v1 } from 'googleapis';
import { log, BillingError } from '../routes/projects';
import * as GcpLegacyService from './gcp_legacy';

// Environment variables
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '';
const CP_PROJECT_ID = process.env.GCP_PROJECT_ID || '';
const GCP_DEFAULT_REGION = process.env.GCP_DEFAULT_REGION || 'europe-west1';
const PLACEHOLDER_IMAGE = 'gcr.io/cloudrun/hello';

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
    await grantSelfPermissionsToNewProject(crm, projectId);
    
    const projectNumber = await getProjectNumber(crm, projectId);
    await enableProjectApis(serviceUsage, projectId);
    await createArtifactRegistryRepo(projectId, 'wizbi');
    
    await addFirebase(firebase, projectId);
    const invokerSaEmail = await createFirebaseInvokerSA(iam, projectId);
    
    const deployerSaEmail = `github-deployer@${projectId}.iam.gserviceaccount.com`;
    await createServiceAccount(iam, projectId, deployerSaEmail);
    
    // Pass the newly created deployer SA to the Cloud Run deployment function
    await deployPlaceholderCloudRunServices(cloudrun, projectId, invokerSaEmail, deployerSaEmail);
    
    await createHostingSites(firebasehosting, projectId);
    
    await grantRolesToServiceAccount(crm, projectId, deployerSaEmail);
    const wifProviderName = await setupWif(iam, projectId, deployerSaEmail);

    log('gcp.provision.all.success', { projectId, projectNumber, finalSa: deployerSaEmail });
    return { projectId, projectNumber, serviceAccountEmail: deployerSaEmail, wifProviderName };
}

async function createProjectAndLinkBilling(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, displayName: string, folderId: string) {
    log('gcp.project.create.attempt', { projectId, displayName, parent: `folders/${folderId}` });
    try {
        const createOp = await crm.projects.create({ requestBody: { projectId, displayName, parent: `folders/${folderId}` } });
        await pollOperation(crm.operations, createOp.data.name!);
        log('gcp.project.create.operation_success', { projectId });
    } catch (error: any) {
        if (error.code === 409) log('gcp.project.create.already_exists', { projectId });
        else { throw error; }
    }

    const billing = google.cloudbilling({ version: 'v1', auth: await getAuth() });
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
            throw new BillingError(error.message, projectId);
        }
        throw error;
    }
}

async function grantSelfPermissionsToNewProject(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string) {
    if (!CP_PROJECT_ID) throw new Error("GCP_PROJECT_ID env var is not set.");
    
    const provisionerSaEmail = `wizbi-provisioner@${CP_PROJECT_ID}.iam.gserviceaccount.com`;
    const rolesToGrant = [
        "roles/artifactregistry.admin", "roles/iam.serviceAccountAdmin",
        "roles/firebase.admin", "roles/run.admin", "roles/storage.admin",
    ];

    log('gcp.iam.grant.self_permissions.start', { projectId, serviceAccount: provisionerSaEmail });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    if (!policy.bindings) policy.bindings = [];

    rolesToGrant.forEach(role => {
        const member = `serviceAccount:${provisionerSaEmail}`;
        let binding = policy.bindings!.find(b => b.role === role);
        if (!binding) {
            binding = { role, members: [] };
            policy.bindings!.push(binding);
        }
        if (!binding.members?.includes(member)) {
            binding.members?.push(member);
        }
    });

    await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
    log('gcp.iam.grant.self_permissions.success', { projectId });
    await new Promise(resolve => setTimeout(resolve, 15000));
}

async function getProjectNumber(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string): Promise<string> {
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber) throw new Error(`Could not retrieve project number for ${projectId}`);
    return projectNumber;
}

async function enableProjectApis(serviceUsage: serviceusage_v1.Serviceusage, projectId: string) {
    const apis = [ 'run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com', 'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com', 'serviceusage.googleapis.com', 'firebasehosting.googleapis.com', 'aiplatform.googleapis.com' ];
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({ parent, requestBody: { serviceIds: apis } });
    await pollOperation(serviceUsage.operations, enableOp.data.name!);
}

async function createArtifactRegistryRepo(projectId: string, repoId: string) {
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
    } catch (error: any) {
        if (error.code !== 409) throw error;
        log('gcp.ar.repo.create.already_exists', { repoId });
    }
}

async function addFirebase(firebase: firebase_v1beta1.Firebase, projectId: string) {
    try {
        const op = await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        await pollOperation(firebase.operations, op.data.name!);
    } catch (error: any) {
        if (error.code !== 409) throw error;
    }
}

async function createFirebaseInvokerSA(iam: iam_v1.Iam, projectId: string): Promise<string> {
    const accountId = 'firebase-hosting-invoker';
    const saEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`;
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'Firebase Hosting to Cloud Run Invoker' } },
        });
    } catch (error: any) {
        if (error.code !== 409) throw error;
    }
    return saEmail;
}

// --- THIS FUNCTION CONTAINS ALL THE FIXES ---
async function deployPlaceholderCloudRunServices(cloudrun: run_v1.Run, projectId: string, invokerSaEmail: string, runtimeSaEmail: string) {
    const servicesToDeploy = [
        { name: `${projectId}-service` },
        { name: `${projectId}-service-qa` }
    ];

    for (const service of servicesToDeploy) {
        log('gcp.cloudrun.deploy.placeholder.start', { serviceName: service.name });
        const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;
        const servicePath = `${parent}/services/${service.name}`;

        try {
            // Step 1: Create the Cloud Run service with the correct runtime identity
            await cloudrun.projects.locations.services.create({
                parent: parent,
                requestBody: {
                    apiVersion: 'serving.knative.dev/v1',
                    kind: 'Service',
                    metadata: { name: service.name },
                    spec: {
                        template: {
                            spec: {
                                // FIX #1: Define the runtime service account explicitly
                                serviceAccountName: runtimeSaEmail,
                                containers: [{ image: PLACEHOLDER_IMAGE }]
                            }
                        }
                    },
                },
            });
            log('gcp.cloudrun.deploy.placeholder.success', { serviceName: service.name });

            // Step 2: Set the IAM policy to allow public access AND Firebase Hosting access
            log('gcp.cloudrun.iam.grant_public_invoker.start', { serviceName: service.name });
            await cloudrun.projects.locations.services.setIamPolicy({
                resource: servicePath,
                requestBody: {
                    policy: {
                        bindings: [{
                            role: 'roles/run.invoker',
                            // FIX #2 & #3: Allow both public access and specific Firebase access
                            members: ['allUsers', `serviceAccount:${invokerSaEmail}`]
                        }]
                    }
                }
            });
            log('gcp.cloudrun.iam.grant_public_invoker.success', { serviceName: service.name });

        } catch (error: any) {
            if (error.code !== 409) {
                 log('gcp.cloudrun.deploy.placeholder.error', { serviceName: service.name, error: error.message });
                 throw error;
            }
            log('gcp.cloudrun.deploy.placeholder.already_exists', { serviceName: service.name });
        }
    }
}


async function createHostingSites(hosting: firebasehosting_v1beta1.Firebasehosting, projectId: string) {
    const sitesToCreate = [ { id: projectId }, { id: `${projectId}-qa` } ];
    for (const site of sitesToCreate) {
        try {
            await hosting.projects.sites.create({ parent: `projects/${projectId}`, siteId: site.id });
        } catch (error: any) {
            if (error.code !== 409) throw error;
        }
    }
}

async function createServiceAccount(iam: iam_v1.Iam, projectId: string, saEmail: string) {
    const accountId = saEmail.split('@')[0];
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'GitHub Actions Deployer' } },
        });
        // Add a delay to allow the SA to propagate
        await new Promise(resolve => setTimeout(resolve, 15000));
    } catch (error: any) {
        if (error.code !== 409) throw error;
    }
}

async function grantRolesToServiceAccount(crm: cloudresourcemanager_v3.Cloudresourcemanager, projectId: string, saEmail: string) {
    const roles = [ 'roles/run.admin', 'roles/artifactregistry.writer', 'roles/firebase.admin', 'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageAdmin', 'roles/aiplatform.user' ];
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
    }
}

async function setupWif(iam: iam_v1.Iam, newProjectId: string, saEmail: string): Promise<string> {
    if (!CP_PROJECT_NUMBER) throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER env var is not set.");
    
    const controlPlaneProject = `projects/${CP_PROJECT_NUMBER}`;
    const poolId = 'github-pool';
    const providerId = newProjectId;
    const poolPath = `${controlPlaneProject}/locations/global/workloadIdentityPools/${poolId}`;
    const attributeCondition = `attribute.repository == '${GITHUB_OWNER}/${newProjectId}'`;

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
    } catch (error: any) {
        if (error.code !== 409) throw error;
    }
    
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
    }
    const providerName = `${poolPath}/providers/${providerId}`;
    return providerName;
}

async function pollOperation(operationsClient: any, operationName: string, maxRetries = 20, delay = 5000) {
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const op = await operationsClient.get({ name: operationName });
        if (op.data.done) {
            if (op.data.error) {
                 throw new Error(`Operation ${operationName} failed: ${op.data.error.message}`);
            }
            return;
        }
    }
    throw new Error(`Operation ${operationName} timed out.`);
}

export const { createGcpFolderForOrg, deleteGcpFolder, deleteGcpProject } = GcpLegacyService;

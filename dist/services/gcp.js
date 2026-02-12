"use strict";
// --- FINAL, FULLY AUTOMATED VERSION ---
// File path: src/services/gcp.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGcpProject = exports.deleteGcpFolder = exports.createGcpFolderForOrg = void 0;
exports.provisionProjectInfrastructure = provisionProjectInfrastructure;
const googleapis_1 = require("googleapis");
const projects_1 = require("../routes/projects");
const GcpLegacyService = __importStar(require("./gcp_legacy"));
// Environment variables
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const CP_PROJECT_NUMBER = process.env.GCP_CONTROL_PLANE_PROJECT_NUMBER || '';
const CP_PROJECT_ID = process.env.GCP_PROJECT_ID || '';
const GCP_DEFAULT_REGION = process.env.GCP_DEFAULT_REGION || 'europe-west1';
const PLACEHOLDER_IMAGE = 'gcr.io/cloudrun/hello';
async function getAuth() {
    return googleapis_1.google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}
async function provisionProjectInfrastructure(projectId, displayName, folderId) {
    (0, projects_1.log)('gcp.provision.all.start', { projectId, displayName, parentFolder: folderId, region: GCP_DEFAULT_REGION });
    const auth = await getAuth();
    const crm = googleapis_1.google.cloudresourcemanager({ version: 'v3', auth });
    const iam = googleapis_1.google.iam({ version: 'v1', auth });
    const serviceUsage = googleapis_1.google.serviceusage({ version: 'v1', auth });
    const firebase = googleapis_1.google.firebase({ version: 'v1beta1', auth });
    const firebasehosting = googleapis_1.google.firebasehosting({ version: 'v1beta1', auth });
    const cloudrun = googleapis_1.google.run({ version: 'v1', auth });
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
    (0, projects_1.log)('gcp.provision.all.success', { projectId, projectNumber, finalSa: deployerSaEmail });
    return { projectId, projectNumber, serviceAccountEmail: deployerSaEmail, wifProviderName };
}
async function createProjectAndLinkBilling(crm, projectId, displayName, folderId) {
    (0, projects_1.log)('gcp.project.create.attempt', { projectId, displayName, parent: `folders/${folderId}` });
    try {
        const createOp = await crm.projects.create({ requestBody: { projectId, displayName, parent: `folders/${folderId}` } });
        await pollOperation(crm.operations, createOp.data.name);
        (0, projects_1.log)('gcp.project.create.operation_success', { projectId });
    }
    catch (error) {
        if (error.code === 409)
            (0, projects_1.log)('gcp.project.create.already_exists', { projectId });
        else {
            throw error;
        }
    }
    const billing = googleapis_1.google.cloudbilling({ version: 'v1', auth: await getAuth() });
    await new Promise(resolve => setTimeout(resolve, 30000));
    try {
        (0, projects_1.log)('gcp.billing.link.attempt', { projectId, billingAccount: BILLING_ACCOUNT_ID });
        await billing.projects.updateBillingInfo({
            name: `projects/${projectId}`,
            requestBody: { billingAccountName: `billingAccounts/${BILLING_ACCOUNT_ID}` },
        });
        (0, projects_1.log)('gcp.billing.link.success', { projectId });
    }
    catch (error) {
        if (error.message && error.message.includes('The caller does not have permission')) {
            throw new projects_1.BillingError(error.message, projectId);
        }
        throw error;
    }
}
async function grantSelfPermissionsToNewProject(crm, projectId) {
    if (!CP_PROJECT_ID)
        throw new Error("GCP_PROJECT_ID env var is not set.");
    const provisionerSaEmail = `wizbi-provisioner@${CP_PROJECT_ID}.iam.gserviceaccount.com`;
    const rolesToGrant = [
        "roles/artifactregistry.admin", "roles/iam.serviceAccountAdmin",
        "roles/firebase.admin", "roles/run.admin", "roles/storage.admin",
    ];
    (0, projects_1.log)('gcp.iam.grant.self_permissions.start', { projectId, serviceAccount: provisionerSaEmail });
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    if (!policy.bindings)
        policy.bindings = [];
    rolesToGrant.forEach(role => {
        const member = `serviceAccount:${provisionerSaEmail}`;
        let binding = policy.bindings.find(b => b.role === role);
        if (!binding) {
            binding = { role, members: [] };
            policy.bindings.push(binding);
        }
        if (!binding.members?.includes(member)) {
            binding.members?.push(member);
        }
    });
    await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
    (0, projects_1.log)('gcp.iam.grant.self_permissions.success', { projectId });
    await new Promise(resolve => setTimeout(resolve, 15000));
}
async function getProjectNumber(crm, projectId) {
    const project = await crm.projects.get({ name: `projects/${projectId}` });
    const projectNumber = project.data.name?.split('/')[1];
    if (!projectNumber)
        throw new Error(`Could not retrieve project number for ${projectId}`);
    return projectNumber;
}
async function enableProjectApis(serviceUsage, projectId) {
    const apis = ['run.googleapis.com', 'iam.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'firebase.googleapis.com', 'firestore.googleapis.com', 'cloudresourcemanager.googleapis.com', 'iamcredentials.googleapis.com', 'serviceusage.googleapis.com', 'firebasehosting.googleapis.com', 'aiplatform.googleapis.com'];
    const parent = `projects/${projectId}`;
    const enableOp = await serviceUsage.services.batchEnable({ parent, requestBody: { serviceIds: apis } });
    await pollOperation(serviceUsage.operations, enableOp.data.name);
}
async function createArtifactRegistryRepo(projectId, repoId) {
    const auth = await getAuth();
    const artifactRegistry = googleapis_1.google.artifactregistry({ version: 'v1', auth });
    const parent = `projects/${projectId}/locations/${GCP_DEFAULT_REGION}`;
    try {
        const createOp = await artifactRegistry.projects.locations.repositories.create({
            parent,
            repositoryId: repoId,
            requestBody: { format: 'DOCKER' },
        });
        await pollOperation(artifactRegistry.projects.locations.operations, createOp.data.name);
    }
    catch (error) {
        if (error.code !== 409)
            throw error;
        (0, projects_1.log)('gcp.ar.repo.create.already_exists', { repoId });
    }
}
async function addFirebase(firebase, projectId) {
    try {
        const op = await firebase.projects.addFirebase({ project: `projects/${projectId}` });
        await pollOperation(firebase.operations, op.data.name);
    }
    catch (error) {
        if (error.code !== 409)
            throw error;
    }
}
async function createFirebaseInvokerSA(iam, projectId) {
    const accountId = 'firebase-hosting-invoker';
    const saEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`;
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'Firebase Hosting to Cloud Run Invoker' } },
        });
    }
    catch (error) {
        if (error.code !== 409)
            throw error;
    }
    return saEmail;
}
// --- THIS FUNCTION CONTAINS ALL THE FIXES ---
async function deployPlaceholderCloudRunServices(cloudrun, projectId, invokerSaEmail, runtimeSaEmail) {
    const servicesToDeploy = [
        { name: `${projectId}-service` },
        { name: `${projectId}-service-qa` }
    ];
    for (const service of servicesToDeploy) {
        (0, projects_1.log)('gcp.cloudrun.deploy.placeholder.start', { serviceName: service.name });
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
            (0, projects_1.log)('gcp.cloudrun.deploy.placeholder.success', { serviceName: service.name });
            // Step 2: Set the IAM policy to allow public access AND Firebase Hosting access
            (0, projects_1.log)('gcp.cloudrun.iam.grant_public_invoker.start', { serviceName: service.name });
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
            (0, projects_1.log)('gcp.cloudrun.iam.grant_public_invoker.success', { serviceName: service.name });
        }
        catch (error) {
            if (error.code !== 409) {
                (0, projects_1.log)('gcp.cloudrun.deploy.placeholder.error', { serviceName: service.name, error: error.message });
                throw error;
            }
            (0, projects_1.log)('gcp.cloudrun.deploy.placeholder.already_exists', { serviceName: service.name });
        }
    }
}
async function createHostingSites(hosting, projectId) {
    const sitesToCreate = [{ id: projectId }, { id: `${projectId}-qa` }];
    for (const site of sitesToCreate) {
        try {
            await hosting.projects.sites.create({ parent: `projects/${projectId}`, siteId: site.id });
        }
        catch (error) {
            if (error.code !== 409)
                throw error;
        }
    }
}
async function createServiceAccount(iam, projectId, saEmail) {
    const accountId = saEmail.split('@')[0];
    try {
        await iam.projects.serviceAccounts.create({
            name: `projects/${projectId}`,
            requestBody: { accountId, serviceAccount: { displayName: 'GitHub Actions Deployer' } },
        });
        // Add a delay to allow the SA to propagate
        await new Promise(resolve => setTimeout(resolve, 15000));
    }
    catch (error) {
        if (error.code !== 409)
            throw error;
    }
}
async function grantRolesToServiceAccount(crm, projectId, saEmail) {
    const roles = ['roles/run.admin', 'roles/artifactregistry.writer', 'roles/firebase.admin', 'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageAdmin', 'roles/aiplatform.user'];
    const resource = `projects/${projectId}`;
    const { data: policy } = await crm.projects.getIamPolicy({ resource });
    if (!policy.bindings)
        policy.bindings = [];
    let needsUpdate = false;
    roles.forEach(role => {
        const member = `serviceAccount:${saEmail}`;
        let binding = policy.bindings.find(b => b.role === role);
        if (binding) {
            if (!binding.members?.includes(member)) {
                binding.members?.push(member);
                needsUpdate = true;
            }
        }
        else {
            policy.bindings.push({ role, members: [member] });
            needsUpdate = true;
        }
    });
    if (needsUpdate) {
        await crm.projects.setIamPolicy({ resource, requestBody: { policy } });
    }
}
async function setupWif(iam, newProjectId, saEmail) {
    if (!CP_PROJECT_NUMBER)
        throw new Error("GCP_CONTROL_PLANE_PROJECT_NUMBER env var is not set.");
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
    }
    catch (error) {
        if (error.code !== 409)
            throw error;
    }
    const saResource = `projects/${newProjectId}/serviceAccounts/${saEmail}`;
    const wifMember = `principalSet://iam.googleapis.com/${poolPath}/attribute.repository/${GITHUB_OWNER}/${newProjectId}`;
    const { data: saPolicy } = await iam.projects.serviceAccounts.getIamPolicy({ resource: saResource });
    const role = 'roles/iam.workloadIdentityUser';
    if (!saPolicy.bindings)
        saPolicy.bindings = [];
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
async function pollOperation(operationsClient, operationName, maxRetries = 20, delay = 5000) {
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
exports.createGcpFolderForOrg = GcpLegacyService.createGcpFolderForOrg, exports.deleteGcpFolder = GcpLegacyService.deleteGcpFolder, exports.deleteGcpProject = GcpLegacyService.deleteGcpProject;

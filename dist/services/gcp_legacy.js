"use strict";
// File path: src/services/gcp_legacy.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGcpFolderForOrg = createGcpFolderForOrg;
exports.createGcpProjectInFolder = createGcpProjectInFolder;
exports.deleteGcpProject = deleteGcpProject;
exports.deleteGcpFolder = deleteGcpFolder;
const googleapis_1 = require("googleapis");
const projects_1 = require("../routes/projects");
const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';
async function getAuth() {
    return googleapis_1.google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}
async function createGcpFolderForOrg(orgName) {
    if (!GCP_FOLDER_ID)
        throw new Error('GCP_FOLDER_ID environment variable is not set.');
    const auth = await getAuth();
    const crm = googleapis_1.google.cloudresourcemanager({ version: 'v3', auth });
    (0, projects_1.log)('gcp.folder.create.start', { orgName, parentFolder: GCP_FOLDER_ID });
    const initialOperation = await crm.folders.create({
        requestBody: {
            displayName: orgName,
            parent: `folders/${GCP_FOLDER_ID}`,
        },
    });
    (0, projects_1.log)('gcp.folder.create.operation_pending', { operationName: initialOperation.data.name });
    let isDone = false;
    let finalOperation;
    while (!isDone) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        (0, projects_1.log)('gcp.folder.create.polling', { operationName: initialOperation.data.name });
        const op = await crm.operations.get({ name: initialOperation.data.name });
        finalOperation = op.data;
        isDone = finalOperation.done || false;
    }
    if (!finalOperation?.response?.name) {
        throw new Error('Folder creation operation did not complete successfully or has no response.');
    }
    const folderName = finalOperation.response.name;
    const folderId = folderName.split('/')[1];
    (0, projects_1.log)('gcp.folder.create.success', { folderName, folderId });
    return folderId;
}
async function createGcpProjectInFolder(projectId, displayName, folderId) {
    if (!BILLING_ACCOUNT_ID)
        throw new Error('BILLING_ACCOUNT_ID environment variable is not set.');
    const auth = await getAuth();
    const crm = googleapis_1.google.cloudresourcemanager({ version: 'v3', auth });
    (0, projects_1.log)('gcp.project.create.start', { projectId, displayName, parentFolder: folderId });
    const initialOperation = await crm.projects.create({
        requestBody: {
            projectId,
            displayName,
            parent: `folders/${folderId}`,
        },
    });
    (0, projects_1.log)('gcp.project.create.operation_pending', { operationName: initialOperation.data.name });
    let isDone = false;
    while (!isDone) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const op = await crm.operations.get({ name: initialOperation.data.name });
        isDone = op.data.done || false;
    }
    (0, projects_1.log)('gcp.project.create.success', { projectId });
    (0, projects_1.log)('gcp.project.billing.link.start', { projectId, billingAccountId: BILLING_ACCOUNT_ID });
    const billing = googleapis_1.google.cloudbilling({ version: 'v1', auth });
    await billing.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: {
            billingAccountName: `billingAccounts/${BILLING_ACCOUNT_ID}`,
        },
    });
    (0, projects_1.log)('gcp.project.billing.link.success', { projectId });
    return projectId;
}
async function deleteGcpProject(projectId) {
    const auth = await getAuth();
    const crm = googleapis_1.google.cloudresourcemanager({ version: 'v3', auth });
    (0, projects_1.log)('gcp.project.delete.start', { projectId });
    try {
        await crm.projects.delete({ name: `projects/${projectId}` });
        (0, projects_1.log)('gcp.project.delete.success', { projectId });
    }
    catch (error) {
        if (error.code === 404 || error.code === 403) {
            (0, projects_1.log)('gcp.project.delete.already_gone', { projectId, code: error.code });
            return;
        }
        (0, projects_1.log)('gcp.project.delete.error', { projectId, error: error.message });
        throw new Error(`Failed to delete GCP project '${projectId}': ${error.message}`);
    }
}
async function deleteGcpFolder(folderId) {
    const auth = await getAuth();
    const crm = googleapis_1.google.cloudresourcemanager({ version: 'v3', auth });
    (0, projects_1.log)('gcp.folder.delete.start', { folderId });
    try {
        await crm.folders.delete({ name: `folders/${folderId}` });
        (0, projects_1.log)('gcp.folder.delete.success', { folderId });
    }
    catch (error) {
        if (error.code === 404) {
            (0, projects_1.log)('gcp.folder.delete.already_gone', { folderId });
            return;
        }
        (0, projects_1.log)('gcp.folder.delete.error', { folderId, error: error.message });
        throw new Error(`Failed to delete GCP folder '${folderId}': ${error.message}`);
    }
}

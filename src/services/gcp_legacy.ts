// File path: src/services/gcp_legacy.ts

import { google } from 'googleapis';
import { log } from '../routes/projects';

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';
const BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID || '';

async function getAuth() {
    return google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

export async function createGcpFolderForOrg(orgName: string): Promise<string> {
    if (!GCP_FOLDER_ID) throw new Error('GCP_FOLDER_ID environment variable is not set.');
    
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    log('gcp.folder.create.start', { orgName, parentFolder: GCP_FOLDER_ID });
    const initialOperation = await crm.folders.create({
        requestBody: {
            displayName: orgName,
            parent: `folders/${GCP_FOLDER_ID}`,
        },
    });
    log('gcp.folder.create.operation_pending', { operationName: initialOperation.data.name });

    let isDone = false;
    let finalOperation;
    while (!isDone) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        log('gcp.folder.create.polling', { operationName: initialOperation.data.name! });
        const op = await crm.operations.get({ name: initialOperation.data.name! });
        finalOperation = op.data;
        isDone = finalOperation.done || false;
    }

    if (!finalOperation?.response?.name) {
        throw new Error('Folder creation operation did not complete successfully or has no response.');
    }

    const folderName = finalOperation.response.name;
    const folderId = folderName.split('/')[1];
    log('gcp.folder.create.success', { folderName, folderId });
    return folderId;
}

export async function createGcpProjectInFolder(projectId: string, displayName: string, folderId: string): Promise<string> {
    if (!BILLING_ACCOUNT_ID) throw new Error('BILLING_ACCOUNT_ID environment variable is not set.');
    
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    log('gcp.project.create.start', { projectId, displayName, parentFolder: folderId });
    const initialOperation = await crm.projects.create({
        requestBody: {
            projectId,
            displayName,
            parent: `folders/${folderId}`,
        },
    });
    log('gcp.project.create.operation_pending', { operationName: initialOperation.data.name });
    
    let isDone = false;
    while (!isDone) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const op = await crm.operations.get({ name: initialOperation.data.name! });
        isDone = op.data.done || false;
    }
    log('gcp.project.create.success', { projectId });

    log('gcp.project.billing.link.start', { projectId, billingAccountId: BILLING_ACCOUNT_ID });
    const billing = google.cloudbilling({ version: 'v1', auth });
    await billing.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: {
            billingAccountName: `billingAccounts/${BILLING_ACCOUNT_ID}`,
        },
    });
    log('gcp.project.billing.link.success', { projectId });

    return projectId;
}

export async function deleteGcpProject(projectId: string): Promise<void> {
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    log('gcp.project.delete.start', { projectId });
    try {
        await crm.projects.delete({ name: `projects/${projectId}` });
        log('gcp.project.delete.success', { projectId });
    } catch (error: any) {
        if (error.code === 404 || error.code === 403) {
            log('gcp.project.delete.already_gone', { projectId, code: error.code });
            return;
        }
        log('gcp.project.delete.error', { projectId, error: error.message });
        throw new Error(`Failed to delete GCP project '${projectId}': ${error.message}`);
    }
}

export async function deleteGcpFolder(folderId: string): Promise<void> {
    const auth = await getAuth();
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    log('gcp.folder.delete.start', { folderId });
    try {
        await crm.folders.delete({ name: `folders/${folderId}` });
        log('gcp.folder.delete.success', { folderId });
    } catch (error: any) {
        if (error.code === 404) {
            log('gcp.folder.delete.already_gone', { folderId });
            return;
        }
        log('gcp.folder.delete.error', { folderId, error: error.message });
        throw new Error(`Failed to delete GCP folder '${folderId}': ${error.message}`);
    }
}

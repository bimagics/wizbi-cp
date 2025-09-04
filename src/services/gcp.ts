// src/services/gcp.ts
import { google } from 'googleapis';
import { log } from '../routes/projects';

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';
const BILLING_ACCOUNT = process.env.BILLING_ACCOUNT || '';
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'wizbi';

/**
 * Creates a new Folder in GCP for an organization.
 * @param orgName The name of the organization.
 * @returns The ID of the created folder (e.g., "123456789").
 */
export async function createGcpFolderForOrg(orgName: string): Promise<string> {
    if (!GCP_FOLDER_ID) throw new Error('GCP_FOLDER_ID environment variable is not set.');
    
    log('gcp.folder.create.start', { orgName });
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    const operation = await crm.folders.create({
        requestBody: {
            displayName: orgName,
            parent: `folders/${GCP_FOLDER_ID}`,
        },
    });
    
    // Polling the operation until it's done is the robust way.
    let done = false;
    let response;
    while (!done) {
        [response] = await crm.operations.get({ name: operation.data.name! });
        done = response.data.done || false;
        if (!done) await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds
    }

    const folderName = response.data.response?.name;
    if (!folderName) throw new Error('Folder creation did not return a folder name.');

    const folderId = folderName.split('/')[1];
    log('gcp.folder.create.success', { folderName, folderId });
    return folderId;
}

// TODO: Add functions for createGcpProjectInFolder, linkBillingToProject, etc.

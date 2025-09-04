// src/services/gcp.ts
import { google } from 'googleapis';
import { log } from '../routes/projects'; // We can reuse the logger

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';
const BILLING_ACCOUNT = process.env.BILLING_ACCOUNT || '';

/**
 * Creates a new Folder in GCP for an organization.
 * @param orgName The name of the organization.
 * @returns The full name of the created folder (e.g., "folders/12345").
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
    
    // In a production system, you would poll the operation until completion.
    // For now, we assume it completes quickly.
    const folder = await crm.folders.get({ name: operation.data.name });
    log('gcp.folder.create.success', { folderName: folder.data.name });
    return folder.data.name!;
}

// TODO: Add functions for createGcpProjectInFolder, linkBillingToProject, enableApisForProject, etc.

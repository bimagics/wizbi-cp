// src/services/gcp.ts
import { google } from 'googleapis';
import { log } from '../routes/projects';

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';

export async function createGcpFolderForOrg(orgName: string): Promise<string> {
    if (!GCP_FOLDER_ID) throw new Error('GCP_FOLDER_ID environment variable is not set.');
    
    log('gcp.folder.create.start', { orgName });
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    const operationResponse = await crm.folders.create({
        requestBody: {
            displayName: orgName,
            parent: `folders/${GCP_FOLDER_ID}`,
        },
    });
    
    let isDone = false;
    let operation;
    while (!isDone) {
        // The array destructuring was causing the issue, let's use a direct assignment.
        operation = await crm.operations.get({ name: operationResponse.data.name! });
        isDone = operation.data.done || false;
        if (!isDone) await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Now, we can safely access the response.
    if (!operation || !operation.data.response) {
        throw new Error('Folder creation operation did not complete successfully or has no response.');
    }

    const folderName = operation.data.response.name;
    if (!folderName) throw new Error('Folder creation did not return a folder name.');

    const folderId = folderName.split('/')[1];
    log('gcp.folder.create.success', { folderName, folderId });
    return folderId;
}

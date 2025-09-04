import { google } from 'googleapis';
import { log } from '../routes/projects';

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';

export async function createGcpFolderForOrg(orgName: string): Promise<string> {
    if (!GCP_FOLDER_ID) throw new Error('GCP_FOLDER_ID environment variable is not set.');
    
    log('gcp.folder.create.start', { orgName });
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    const initialOperation = await crm.folders.create({
        requestBody: {
            displayName: orgName,
            parent: `folders/${GCP_FOLDER_ID}`,
        },
    });

    let isDone = false;
    let finalOperation;
    while (!isDone) {
        const op = await crm.operations.get({ name: initialOperation.data.name! });
        finalOperation = op.data;
        isDone = finalOperation.done || false;
        if (!isDone) await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!finalOperation?.response?.name) {
        throw new Error('Folder creation operation did not complete successfully or has no response.');
    }

    const folderName = finalOperation.response.name;
    const folderId = folderName.split('/')[1];
    log('gcp.folder.create.success', { folderName, folderId });
    return folderId;
}

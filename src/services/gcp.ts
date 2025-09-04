import { google } from 'googleapis';
import { log } from '../routes/projects';

const GCP_FOLDER_ID = process.env.GCP_FOLDER_ID || '';

export async function createGcpFolderForOrg(orgName: string): Promise<string> {
    if (!GCP_FOLDER_ID) throw new Error('GCP_FOLDER_ID environment variable is not set.');
    
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
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
        log('gcp.folder.create.polling', { operationName: initialOperation.data.name });
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

import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAdminAuth } from './projects';
import { createGcpFolderForOrg } from '../services/gcp'; // Import the new GCP service
import { log } from './projects';

const router = Router();
const ORGS_COLLECTION = 'orgs';

router.get('/orgs', requireAdminAuth, async (_req: Request, res: Response) => {
  // ... (no changes to the GET method)
});

router.post('/orgs', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'missing-name' });

    // Step 1: Create the GCP Folder for the Org
    const gcpFolderName = await createGcpFolderForOrg(name);
    const gcpFolderId = gcpFolderName.split('/')[1];

    // Step 2: Create the Org document in Firestore with the new GCP Folder ID
    const docRef = await getDb().collection(ORGS_COLLECTION).add({
      name,
      phone,
      gcpFolderId, // Store the folder ID
      createdAt: new Date().toISOString(),
    });

    log('org.create.success', { orgId: docRef.id, gcpFolderId });
    res.status(201).json({ ok: true, id: docRef.id });
  } catch (e: any) {
    log('org.create.error', { error: e.message });
    res.status(500).json({ ok: false, error: 'create-failed', detail: e.message });
  }
});

export default router;

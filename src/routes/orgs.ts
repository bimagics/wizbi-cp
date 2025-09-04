import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAdminAuth, log } from './projects';
import { createGcpFolderForOrg } from '../services/gcp';
import { createGithubTeam } from '../services/github';

const router = Router();
const ORGS_COLLECTION = 'orgs';

router.get('/orgs', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
        const snap = await getDb().collection(ORGS_COLLECTION).orderBy('name').get();
        const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ ok: true, items });
    } catch (e: any) {
        log('orgs.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'list-failed' });
    }
});

router.post('/orgs', requireAdminAuth, async (req: Request, res: Response) => {
  log('orgs.create.received', { body: req.body });
  try {
    const { name, phone } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'missing-name' });

    const gcpFolderId = await createGcpFolderForOrg(name);
    const { id: githubTeamId, slug: githubTeamSlug } = await createGithubTeam(name);

    log('orgs.create.firestore.start', { name });
    const docRef = await getDb().collection(ORGS_COLLECTION).add({
      name,
      phone,
      gcpFolderId,
      githubTeamId,
      githubTeamSlug,
      createdAt: new Date().toISOString(),
    });
    log('orgs.create.firestore.success', { orgId: docRef.id });

    res.status(201).json({ ok: true, id: docRef.id });
  } catch (e: any) {
    log('orgs.create.error', { error: e.message, stack: e.stack });
    res.status(500).json({ ok: false, error: 'create-failed', detail: e.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAdminAuth, log } from './projects';
import * as GcpService from '../services/gcp';
import * as GithubService from '../services/github';

const router = Router();
const ORGS_COLLECTION = 'orgs';
const PROJECTS_COLLECTION = 'projects';

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

    const gcpFolderId = await GcpService.createGcpFolderForOrg(name);
    const { id: githubTeamId, slug: githubTeamSlug } = await GithubService.createGithubTeam(name);

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

// --- NEW DELETE ROUTE FOR ORGS ---
router.delete('/orgs/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const { id } = req.params;
    log('org.delete.received', { orgId: id });

    try {
        // **SAFETY CHECK**: Ensure no projects are associated with this org
        const projectsSnap = await getDb().collection(PROJECTS_COLLECTION).where('orgId', '==', id).limit(1).get();
        if (!projectsSnap.empty) {
            log('org.delete.error.has_projects', { orgId: id });
            return res.status(400).json({ error: 'Cannot delete organization with active projects. Please delete all associated projects first.' });
        }

        const orgDoc = await getDb().collection(ORGS_COLLECTION).doc(id).get();
        if (!orgDoc.exists) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const orgData = orgDoc.data()!;

        // Mark for deletion in Firestore
        await getDb().collection(ORGS_COLLECTION).doc(id).update({ state: 'deleting' });

        // Fire and forget deletion process
        (async () => {
            try {
                if (orgData.gcpFolderId) {
                    await GcpService.deleteGcpFolder(orgData.gcpFolderId);
                }
                if (orgData.githubTeamSlug) {
                    await GithubService.deleteGithubTeam(orgData.githubTeamSlug);
                }
                await getDb().collection(ORGS_COLLECTION).doc(id).delete();
                log('org.delete.success', { orgId: id });
            } catch (error: any) {
                log('org.delete.error.fatal', { orgId: id, error: error.message });
                await getDb().collection(ORGS_COLLECTION).doc(id).update({ state: 'delete_failed', error: error.message });
            }
        })();

        res.status(202).json({ ok: true, message: 'Organization deletion started.' });

    } catch (e: any) {
        log('org.delete.error.initial', { orgId: id, error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to start organization deletion.' });
    }
});

export default router;

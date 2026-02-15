// src/routes/orgs.ts
import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAuth, requireAdminAuth, log } from '../middleware/auth';
import * as GcpService from '../services/gcp';
import * as GithubService from '../services/github';

const router = Router();
const ORGS_COLLECTION = 'orgs';
const PROJECTS_COLLECTION = 'projects';

router.get('/orgs', requireAuth, async (req: Request, res: Response) => {
    try {
        const userProfile = (req as any).userProfile;

        // Super Admins see all organizations
        if (userProfile?.roles?.superAdmin) {
            const snap = await getDb().collection(ORGS_COLLECTION).orderBy('name').get();
            const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.json({ ok: true, items });
        }

        // Org Admins see only their assigned organizations
        const orgIds = userProfile?.roles?.orgAdmin || [];
        if (orgIds.length === 0) {
            return res.json({ ok: true, items: [] }); // No orgs assigned, return empty
        }

        // --- FIX: Added (id: string) to explicitly type the parameter ---
        const orgPromises = orgIds.map((id: string) => getDb().collection(ORGS_COLLECTION).doc(id).get());
        const orgDocs = await Promise.all(orgPromises);
        const items = orgDocs
            .filter(doc => doc.exists)
            .map(doc => ({ id: doc.id, ...doc.data() }));

        res.json({ ok: true, items });

    } catch (e: any) {
        log('orgs.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'list-failed' });
    }
});

// Creating an org still requires a super admin
router.post('/orgs', requireAdminAuth, async (req: Request, res: Response) => {
    log('orgs.create.received', { body: req.body });
    try {
        const { name } = req.body || {};
        if (!name) return res.status(400).json({ ok: false, error: 'missing-name' });

        // GCP folder and GitHub team are optional — skip if not configured
        let gcpFolderId: string | undefined;
        let githubTeamId: number | undefined;
        let githubTeamSlug: string | undefined;

        try {
            gcpFolderId = await GcpService.createGcpFolderForOrg(name);
        } catch (e: any) {
            log('orgs.create.gcp_folder.skipped', { reason: e.message });
        }

        try {
            const team = await GithubService.createGithubTeam(name);
            githubTeamId = team.id;
            githubTeamSlug = team.slug;
        } catch (e: any) {
            log('orgs.create.github_team.skipped', { reason: e.message });
        }

        log('orgs.create.firestore.start', { name });
        const docRef = await getDb().collection(ORGS_COLLECTION).add({
            name,
            ...(gcpFolderId && { gcpFolderId }),
            ...(githubTeamId && { githubTeamId }),
            ...(githubTeamSlug && { githubTeamSlug }),
            createdAt: new Date().toISOString(),
        });
        log('orgs.create.firestore.success', { orgId: docRef.id });

        res.status(201).json({ ok: true, id: docRef.id });
    } catch (e: any) {
        log('orgs.create.error', { error: e.message, stack: e.stack });
        res.status(500).json({ ok: false, error: 'create-failed', detail: e.message });
    }
});

// Deleting an org still requires a super admin
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

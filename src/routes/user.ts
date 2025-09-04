// src/routes/user.ts
import { Router, Request, Response } from 'express';
import { getDb } from '../services/firebaseAdmin';
import { requireAuth, requireAdminAuth, log } from './projects'; // Re-using auth middleware

const router = Router();
const USERS_COLLECTION = 'users';

// --- THIS IS THE MISSING ROUTE ---
// Fetches the profile of the currently logged-in user.
router.get('/me', requireAuth, async (req: any, res: Response) => {
  if (!req.userProfile) {
    return res.status(404).json({ error: 'User profile not found.' });
  }
  res.json(req.userProfile);
});
// ---------------------------------

// GET all users (for superAdmin)
router.get('/users', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
        const snap = await getDb().collection(USERS_COLLECTION).get();
        const users = snap.docs.map(doc => {
            const data = doc.data();
            if (!data.roles) {
                data.roles = {};
            }
            return {
                uid: doc.id,
                email: data.email,
                roles: data.roles,
            };
        });
        res.json(users);
    } catch (e: any) {
        log('users.list.error', { error: e.message });
        res.status(500).json({ ok: false, error: 'Failed to list users' });
    }
});

// UPDATE a user's roles/orgs (for superAdmin)
router.put('/users/:uid', requireAdminAuth, async (req: Request, res: Response) => {
    const { uid } = req.params;
    const { roles } = req.body;

    if (!roles) {
        return res.status(400).json({ error: 'Missing roles object in request body.' });
    }

    log('user.update.received', { uid, roles });
    try {
        const userRef = getDb().collection(USERS_COLLECTION).doc(uid);
        await userRef.update({
            roles: roles
        });
        log('user.update.success', { uid });
        res.status(200).json({ ok: true, message: 'User updated successfully.' });
    } catch (e: any) {
        log('user.update.error', { uid, error: e.message });
        res.status(500).json({ ok: false, error: `Failed to update user: ${e.message}` });
    }
});


export default router;

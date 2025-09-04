// --- REPLACE THE ENTIRE FILE CONTENT ---

import { Router, Response } from 'express';
import { requireAuth } from './tenants'; // Import the new combined middleware

const router = Router();

// This endpoint now receives the user profile from the fetchUserProfile middleware
// and simply returns it to the client.
router.get('/me', requireAuth, async (req: any, res: Response) => {
  // The userProfile is attached to the request by the middleware
  if (!req.userProfile) {
    return res.status(404).json({ error: 'User profile not found.' });
  }
  res.json(req.userProfile);
});

export default router;

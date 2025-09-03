import { Router } from 'express';
import { google } from 'googleapis';

const router = Router();

// helper לנרמול scopes מ-query: ?scopes=... או ?scopes=a&scopes=b
function normalizeScopes(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap((s) => (s ? String(s).split(',') : [])).map((s) => s.trim()).filter(Boolean);
  return String(input)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

router.post('/factory/projects', async (req, res) => {
  try {
    // קלט
    const {
      projectId,
      displayName,
      parentType, // 'folder' | 'organization' | 'org'
      parentId,   // '1234567890'
      billingAccount, // אופציונלי ('AAAAAA-BBBBBB-CCCCCC')
    } = req.body ?? {};

    if (!projectId) return res.status(400).json({ ok: false, error: 'missing-projectId' });

    // scopes אופציונלי מה-query
    const scopes = normalizeScopes(req.query.scopes as any);
    const auth = await google.auth.getClient({
      scopes: scopes.length ? scopes : ['https://www.googleapis.com/auth/cloud-platform'],
    });

    // Cloud Resource Manager v3
    const crm = google.cloudresourcemanager({ version: 'v3', auth });

    // parent בפורמט string ("folders/123" או "organizations/123")
    let parent: string | undefined;
    if (parentType === 'folder') parent = `folders/${parentId}`;
    else if (parentType === 'organization' || parentType === 'org') parent = `organizations/${parentId}`;

    const createResp = await crm.projects.create({
      requestBody: {
        projectId,
        displayName: displayName || projectId,
        parent, // string | undefined
      },
    });

    const operationName = createResp.data.name;

    // הצמדת Billing אם ביקשת
    if (billingAccount) {
      const cloudBilling = google.cloudbilling({ version: 'v1', auth });
      await cloudBilling.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: {
          billingAccountName: `billingAccounts/${billingAccount}`,
        },
      });
    }

    return res.json({
      ok: true,
      projectId,
      operation: operationName ?? null,
    });
  } catch (err: any) {
    console.error('factory/projects error:', err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: 'factory-projects-failed' });
  }
});

export default router;

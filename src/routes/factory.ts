import type { Express, Request, Response } from 'express';
import { google } from 'googleapis';
import { db } from '../services/firebaseAdmin';

/** קבלה אחידה של רשימת אימיילים ממחרוזת/מערך/ערך בודד */
function parseAdminList(input?: string | string[]): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(',');
  return arr.map(s => String(s).trim()).filter(Boolean);
}

async function createGcpProject(
  projectId: string,
  name: string,
  parent: { selector: 'organization' | 'folder'; id: string }
) {
  const cloudresourcemanager = google.cloudresourcemanager('v3');

  // parent חייב להיות בתוך ה-requestBody!
  const requestBody: any = {
    projectId,
    name,
    parent: {
      type: parent.selector, // 'organization' | 'folder'
      id: parent.id,
    },
  };

  const op = await cloudresourcemanager.projects.create({ requestBody });
  const opName = (op.data as any)?.name;

  return { opName };
}

export function registerFactoryRoutes(app: Express) {
  app.post('/factory/projects', async (req: Request, res: Response) => {
    try {
      const { projectId, name, parent, admins } = req.body ?? {};
      if (!projectId || !name || !parent?.selector || !parent?.id) {
        return res.status(400).json({ ok: false, error: 'missing-params' });
      }

      const adminsList = parseAdminList(admins || process.env.ADMINS || '');
      const { opName } = await createGcpProject(projectId, name, parent);

      await db.collection('factory-ops').doc(projectId).set({
        projectId,
        name,
        parent,
        admins: adminsList,
        opName,
        createdAt: new Date().toISOString(),
      });

      res.json({ ok: true, opName, admins: adminsList });
    } catch (err: any) {
      console.error('factory.create.error', err?.message || err);
      res.status(500).json({ ok: false, error: 'factory-create-failed' });
    }
  });
}

// ייצוא בשם + ייצוא ברירת־מחדל – כדי לעבוד גם עם import {} וגם עם import default
export default registerFactoryRoutes;

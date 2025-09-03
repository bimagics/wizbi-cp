import { Express, Request, Response } from "express";
import { requireFirebaseUser, requireAdmin } from "../middleware/auth";
import { google } from "googleapis";

type CreateProjectReq = {
  projectId: string;          // לדוגמה: my-new-proj-123
  displayName?: string;       // שם תצוגה
  parentType?: "organization" | "folder"; // ברירת מחדל מה-ENV
  parentId?: string;          // ORG_ID או FOLDER_ID (ללא "organizations/")
  billingAccount?: string;    // לדוגמה: 012345-6789AB-CDEF01
  enableApis?: string[];      // רשימת APIs להפעלה
};

const DEFAULT_PARENT_TYPE = (process.env.DEFAULT_PARENT_TYPE as "organization"|"folder") || "organization";
const DEFAULT_PARENT_ID   = process.env.DEFAULT_PARENT_ID || ""; // שים ORG_ID או FOLDER_ID
const DEFAULT_BILLING     = process.env.DEFAULT_BILLING_ACCOUNT || "";
const DEFAULT_APIS = (process.env.DEFAULT_ENABLE_APIS || [
  "serviceusage.googleapis.com",
  "cloudbilling.googleapis.com",
  "iam.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "compute.googleapis.com",
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudbuild.googleapis.com",
  "secretmanager.googleapis.com",
  "firestore.googleapis.com",
]).join(",").split(",").map(s => s.trim()).filter(Boolean);

export function registerFactoryRoutes(app: Express) {
  // מוגן: דורש משתמש + אדמין
  app.post("/factory/projects", requireFirebaseUser, requireAdmin, async (req: Request, res: Response) => {
    const body = (req.body || {}) as CreateProjectReq;

    const projectId    = body.projectId;
    if (!projectId) return res.status(400).json({ ok: false, error: "projectId-required" });

    const parentType   = body.parentType || DEFAULT_PARENT_TYPE;
    const parentId     = body.parentId   || DEFAULT_PARENT_ID;
    const billingAcct  = body.billingAccount || DEFAULT_BILLING;
    const apis         = (body.enableApis && body.enableApis.length ? body.enableApis : DEFAULT_APIS);

    if (!parentId) return res.status(400).json({ ok: false, error: "parentId-required" });
    if (!billingAcct) return res.status(400).json({ ok: false, error: "billingAccount-required" });

    try {
      const auth = await google.auth.getClient({
        scopes: [
          "https://www.googleapis.com/auth/cloud-platform",
          "https://www.googleapis.com/auth/cloud-billing"
        ],
      });

      const crm = google.cloudresourcemanager({ version: "v3", auth });
      const su  = google.serviceusage({ version: "v1", auth });
      const cb  = google.cloudbilling({ version: "v1", auth });

      // 1) יצירת פרויקט
      const parent = parentType === "folder"
        ? { folder: `folders/${parentId}` }
        : { organization: `organizations/${parentId}` };

      const createOp = await crm.projects.create({
        requestBody: {
          projectId,
          displayName: body.displayName || projectId,
          parent
        }
      });

      // המתנה ל-op
      const opName = createOp.data.name!;
      // פולינג קצר
      let projectNumber: string | undefined;
      for (let i=0; i<20; i++) {
        const op = await crm.operations.get({ name: opName });
        if (op.data.done) {
          const prj = await crm.projects.get({ name: `projects/${projectId}` });
          projectNumber = prj.data.name?.split("/")[1];
          break;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      if (!projectNumber) throw new Error("create-project-timeout");

      // 2) חיבור בילינג
      await cb.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: {
          name: `projects/${projectId}/billingInfo`,
          billingAccountName: `billingAccounts/${billingAcct}`,
          billingEnabled: true,
        }
      });

      // 3) הפעלת APIs
      for (const api of apis) {
        await su.services.enable({
          name: `projects/${projectId}/services/${api}`
        });
      }

      return res.json({
        ok: true, projectId, projectNumber,
        billing: billingAcct, enabledApis: apis
      });
    } catch (e: any) {
      console.error("factory error:", e?.response?.data || e);
      return res.status(500).json({ ok: false, error: "factory-failed", detail: e?.message });
    }
  });
}

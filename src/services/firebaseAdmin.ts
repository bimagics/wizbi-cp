import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let dbSingleton: Firestore | null = null;

export async function getDb(): Promise<Firestore | null> {
  if (dbSingleton) return dbSingleton;

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    // ריצה מקומית/QA בלי פרויקט — פשוט מחזירים null
    return null;
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId
    });
  }

  dbSingleton = getFirestore();
  return dbSingleton;
}

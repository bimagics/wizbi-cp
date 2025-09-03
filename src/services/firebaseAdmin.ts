import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });

export const db: Firestore = getFirestore(app);

// השארתי גם פונקציה אם תרצה API יציב
export function getDb(): Firestore {
  return db;
}

import admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

let adminApp: admin.app.App;
let db: Firestore;
let adminAuth: Auth;

function initAdmin() {
  if (admin.apps.length === 0) {
    const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
      ? admin.credential.cert(
          JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) as ServiceAccount
        )
      : admin.credential.applicationDefault();

    adminApp = admin.initializeApp({
      credential: cred,
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  } else {
    adminApp = admin.app();
  }

  db = getFirestore(adminApp);
  adminAuth = getAuth(adminApp);
}

initAdmin();

export { adminApp, db, adminAuth };
export function getDb() {
  return db;
}

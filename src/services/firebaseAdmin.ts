// src/services/firebaseAdmin.ts
import { Firestore } from '@google-cloud/firestore';

let _db: Firestore | null = null;

/** החזר מופע יחיד של Firestore (אין settings() חוזר) */
export function db(): Firestore {
  if (!_db) {
    _db = new Firestore({
      projectId: process.env.FIREBASE_PROJECT_ID,
      // אם תרצה REST:
      // preferRest: true,
    });
  }
  return _db;
}

import { initializeApp, applicationDefault, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || "wizbi-cp",
    });

export const db: Firestore = getFirestore(app);        // <-- נייצא גם db כדי לתאם עם קוד קיים
export function getDb() { return db; }
export const adminAuth = getAuth(app);

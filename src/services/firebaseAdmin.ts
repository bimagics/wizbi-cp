import { initializeApp, applicationDefault, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let app = getApps().length ? getApp() : initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID || "wizbi-cp",
});

let db: Firestore = getFirestore(app);

export function getDb() {
  return db;
}

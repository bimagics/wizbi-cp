"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuth = exports.db = exports.adminApp = void 0;
exports.getDb = getDb;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
let adminApp;
let db;
let adminAuth;
function initAdmin() {
    if (firebase_admin_1.default.apps.length === 0) {
        const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
            ? firebase_admin_1.default.credential.cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON))
            : firebase_admin_1.default.credential.applicationDefault();
        exports.adminApp = adminApp = firebase_admin_1.default.initializeApp({
            credential: cred,
            projectId: process.env.FIREBASE_PROJECT_ID,
        });
    }
    else {
        exports.adminApp = adminApp = firebase_admin_1.default.app();
    }
    exports.db = db = (0, firestore_1.getFirestore)(adminApp);
    exports.adminAuth = adminAuth = (0, auth_1.getAuth)(adminApp);
}
initAdmin();
function getDb() {
    return db;
}

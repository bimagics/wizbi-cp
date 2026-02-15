// src/middleware/auth.ts
// Unified authentication middleware — supports Firebase ID Token AND API Key.
// This is the single source of truth for auth across the entire application.

import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { getDb } from '../services/firebaseAdmin';

// --- Interfaces & Types ---
export interface UserProfile {
    uid: string;
    email: string;
    roles: { superAdmin?: boolean; orgAdmin?: string[]; };
}

export interface AuthenticatedRequest extends Request {
    user?: admin.auth.DecodedIdToken;
    userProfile?: UserProfile;
    authMethod?: 'firebase' | 'api-key';
}

const db = getDb();
const USERS_COLLECTION = db.collection('users');
const API_KEYS_COLLECTION = db.collection('apiKeys');

// --- Utility ---
export function hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
    return `wizbi_${crypto.randomBytes(32).toString('hex')}`;
}

// --- Middleware Functions ---

/**
 * Attempts Firebase ID Token auth, then falls through to API Key auth.
 * At least one must succeed, otherwise returns 401.
 */
async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // Try Firebase ID Token first
    const token = req.headers['x-firebase-id-token'] as string || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token) {
        try {
            req.user = await admin.auth().verifyIdToken(token);
            req.authMethod = 'firebase';
            return next();
        } catch (e: any) {
            // Token was provided but invalid — don't fallback, reject immediately
            return res.status(401).json({ error: 'Invalid Firebase token', detail: e.message });
        }
    }

    // Try API Key
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
        try {
            const keyHash = hashApiKey(apiKey);
            const snap = await API_KEYS_COLLECTION.where('keyHash', '==', keyHash).where('active', '==', true).limit(1).get();
            if (snap.empty) {
                return res.status(401).json({ error: 'Invalid or revoked API key' });
            }
            const keyData = snap.docs[0].data();
            req.userProfile = keyData.profile as UserProfile;
            req.authMethod = 'api-key';

            // Update last used timestamp (fire and forget)
            snap.docs[0].ref.update({ lastUsed: new Date().toISOString() }).catch(() => { });

            return next();
        } catch (e: any) {
            return res.status(401).json({ error: 'API key validation failed', detail: e.message });
        }
    }

    return res.status(401).json({ error: 'Missing authentication. Provide X-Firebase-ID-Token or X-API-Key header.' });
}

/**
 * Fetches (or auto-creates) the user profile from Firestore.
 * Skipped if auth was via API key (profile already attached).
 */
async function fetchUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // If auth was via API key, profile is already set
    if (req.authMethod === 'api-key' && req.userProfile) {
        return next();
    }

    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const { uid, email } = req.user;
    try {
        const userDoc = await USERS_COLLECTION.doc(uid).get();
        if (!userDoc.exists) {
            // Auto-promote seed admins (from ADMINS env var) or the very first user
            const adminEmails = (process.env.ADMINS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
            const isSeeded = adminEmails.includes((email || '').toLowerCase());
            let isFirstUser = false;
            if (!isSeeded) {
                const existingUsers = await USERS_COLLECTION.limit(1).get();
                isFirstUser = existingUsers.empty;
            }
            const roles = (isSeeded || isFirstUser) ? { superAdmin: true } : {};
            const newUserProfile: UserProfile = { uid, email: email || '', roles };
            if (roles.superAdmin) {
                console.log(JSON.stringify({ evt: 'user.auto_promoted_superadmin', email, reason: isSeeded ? 'ADMINS_env' : 'first_user' }));
            }
            await USERS_COLLECTION.doc(uid).set(newUserProfile);
            req.userProfile = newUserProfile;
        } else {
            req.userProfile = userDoc.data() as UserProfile;
        }
        next();
    } catch (e: any) {
        console.error(JSON.stringify({ evt: 'user.fetchProfile.error', uid: req.user?.uid, email: req.user?.email, error: e.message, code: e.code }));
        res.status(500).json({ error: 'Failed to fetch user profile', detail: e.message });
    }
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (req.userProfile?.roles?.superAdmin !== true) {
        return res.status(403).json({ error: 'Permission denied' });
    }
    next();
}

// --- Exported Middleware Chains ---
export const requireAuth = [authenticate, fetchUserProfile];
export const requireAdminAuth = [...requireAuth, requireSuperAdmin];

// --- Logging Utility ---
export const log = (evt: string, meta: Record<string, any> = {}) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), severity: 'INFO', evt, ...meta }));
};

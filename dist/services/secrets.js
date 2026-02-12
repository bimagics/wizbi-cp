"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecret = getSecret;
const secret_manager_1 = require("@google-cloud/secret-manager");
const projects_1 = require("../routes/projects"); // Reuse the main logger
const client = new secret_manager_1.SecretManagerServiceClient();
const project = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID;
const secretCache = new Map();
async function getSecret(secretName) {
    if (secretCache.has(secretName)) {
        (0, projects_1.log)('secret.cache.hit', { secretName });
        return secretCache.get(secretName);
    }
    (0, projects_1.log)('secret.cache.miss', { secretName });
    try {
        const [version] = await client.accessSecretVersion({
            name: `projects/${project}/secrets/${secretName}/versions/latest`,
        });
        const payload = version.payload?.data?.toString();
        if (!payload) {
            throw new Error(`Secret ${secretName} has an empty payload.`);
        }
        (0, projects_1.log)('secret.fetch.success', { secretName });
        secretCache.set(secretName, payload);
        return payload;
    }
    catch (error) {
        (0, projects_1.log)('secret.fetch.error', { secretName, error: error.message });
        throw new Error(`Could not access secret: ${secretName}`);
    }
}

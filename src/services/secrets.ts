import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const project = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID;

// A cache to avoid fetching the same secret multiple times
const secretCache = new Map<string, string>();

/**
 * Fetches a secret from Google Secret Manager.
 * @param secretName The name of the secret.
 * @returns The secret value as a string.
 */
export async function getSecret(secretName: string): Promise<string> {
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName)!;
  }

  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/${secretName}/versions/latest`,
    });

    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new Error(`Secret ${secretName} has an empty payload.`);
    }
    
    secretCache.set(secretName, payload);
    return payload;
  } catch (error) {
    console.error(`Failed to fetch secret: ${secretName}`, error);
    throw new Error(`Could not access secret: ${secretName}`);
  }
}

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { log } from '../routes/projects'; // Reuse the main logger

const client = new SecretManagerServiceClient();
const project = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID;
const secretCache = new Map<string, string>();

/** Clear cached secrets so fresh values are fetched on next access */
export function clearSecretCache(secretName?: string): void {
  if (secretName) {
    secretCache.delete(secretName);
  } else {
    secretCache.clear();
  }
}

export async function getSecret(secretName: string): Promise<string> {
  if (secretCache.has(secretName)) {
    log('secret.cache.hit', { secretName });
    return secretCache.get(secretName)!;
  }

  log('secret.cache.miss', { secretName });
  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/${secretName}/versions/latest`,
    });

    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new Error(`Secret ${secretName} has an empty payload.`);
    }

    log('secret.fetch.success', { secretName });
    secretCache.set(secretName, payload);
    return payload;
  } catch (error: any) {
    log('secret.fetch.error', { secretName, error: error.message });
    throw new Error(`Could not access secret: ${secretName}`);
  }
}

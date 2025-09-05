// File path: src/services/github.ts

import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";
import { log } from '../routes/projects';
import sodium from 'libsodium-wrappers';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const GITHUB_TEMPLATE_REPO = 'wizbi-template-mono';

let octokit: Octokit;

// --- Interfaces for structured data ---
interface GitHubTeam {
    id: number;
    slug: string;
}

interface GitHubRepo {
    name: string;
    url: string;
}

interface RepoSecrets {
    [key: string]: string;
}

async function getAuthenticatedClient(): Promise<Octokit> {
    if (octokit) return octokit;
    const appId = await getSecret('GITHUB_APP_ID');
    const privateKey = await getSecret('GITHUB_PRIVATE_KEY');
    const installationId = await getSecret('GITHUB_INSTALLATION_ID');
    
    const auth = await createAppAuth({ appId: Number(appId), privateKey, installationId: Number(installationId) });
    const { token } = await auth({ type: "installation" });

    octokit = new Octokit({ auth: token });
    return octokit;
}

export async function createGithubTeam(orgName: string): Promise<GitHubTeam> {
    const client = await getAuthenticatedClient();
    const slug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    log('github.team.create.start', { orgName, slug });
    const { data: team } = await client.teams.create({ org: GITHUB_OWNER, name: `${orgName} Admins`, privacy: 'closed' });
    log('github.team.create.success', { teamId: team.id, teamSlug: team.slug });
    return { id: team.id, slug: team.slug };
}

export async function createGithubRepoFromTemplate(projectName: string, teamSlug: string): Promise<GitHubRepo> {
    const client = await getAuthenticatedClient();
    
    log('github.repo.create_from_template.start', { newRepoName: projectName });
    const { data: repo } = await client.repos.createUsingTemplate({
        template_owner: GITHUB_OWNER,
        template_repo: GITHUB_TEMPLATE_REPO,
        owner: GITHUB_OWNER,
        name: projectName,
        private: true,
    });
    log('github.repo.create_from_template.success', { repoName: repo.name });

    log('github.repo.permission.start', { repoName: repo.name, teamSlug });
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER,
        team_slug: teamSlug,
        repo: repo.name,
        permission: 'admin',
    });
    log('github.repo.permission.success', { repoName: repo.name });

    return { name: repo.name, url: repo.html_url };
}

/**
 * Creates or updates GitHub Actions secrets in a repository.
 * Secrets are encrypted using the repository's public key before being sent.
 */
export async function createRepoSecrets(repoName: string, secrets: RepoSecrets): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.secrets.create.start', { repoName, secrets: Object.keys(secrets) });

    const { data: publicKey } = await client.actions.getRepoPublicKey({
        owner: GITHUB_OWNER,
        repo: repoName,
    });

    await sodium.ready;

    for (const secretName in secrets) {
        const secretValue = secrets[secretName];
        
        const messageBytes = Buffer.from(secretValue);
        const keyBytes = Buffer.from(publicKey.key, 'base64');
        
        const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
        const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');

        await client.actions.createOrUpdateRepoSecret({
            owner: GITHUB_OWNER,
            repo: repoName,
            secret_name: secretName,
            encrypted_value: encryptedBase64,
            key_id: publicKey.key_id,
        });
        log('github.secrets.create.success', { repoName, secretName });
    }
}


// --- Deletion Functions ---

export async function deleteGithubRepo(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.repo.delete.start', { repoName });
    try {
        await client.repos.delete({ owner: GITHUB_OWNER, repo: repoName });
        log('github.repo.delete.success', { repoName });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.repo.delete.already_gone', { repoName });
        } else {
            throw new Error(`Failed to delete GitHub repo '${repoName}': ${error.message}`);
        }
    }
}

export async function deleteGithubTeam(teamSlug: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.team.delete.start', { teamSlug });
    try {
        await client.teams.deleteInOrg({ org: GITHUB_OWNER, team_slug: teamSlug });
        log('github.team.delete.success', { teamSlug });
    } catch (error: any) {
        if (error.status === 404) {
             log('github.team.delete.already_gone', { teamSlug });
        } else {
            throw new Error(`Failed to delete GitHub team '${teamSlug}': ${error.message}`);
        }
    }
}

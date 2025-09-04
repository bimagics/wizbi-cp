import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";
import { log } from '../routes/projects';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
let octokit: Octokit;

async function getAuthenticatedClient(): Promise<Octokit> {
    if (octokit) return octokit;
    const appId = await getSecret('GITHUB_APP_ID');
    const privateKey = await getSecret('GITHUB_PRIVATE_KEY');
    const installationId = await getSecret('GITHUB_INSTALLATION_ID');
    
    const auth = createAppAuth({ appId, privateKey, installationId: Number(installationId) });
    const { token } = await auth({ type: "installation" });

    octokit = new Octokit({ auth: token });
    return octokit;
}

export async function createGithubTeam(orgName: string): Promise<{ id: number; slug: string }> {
    const client = await getAuthenticatedClient();
    const slug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    log('github.team.create.start', { orgName, slug });
    const { data: team } = await client.teams.create({ org: GITHUB_OWNER, name: `${orgName} Admins`, privacy: 'closed' });
    log('github.team.create.success', { teamId: team.id, teamSlug: team.slug });
    return { id: team.id, slug: team.slug };
}

export async function createGithubRepo(projectName: string, teamSlug: string): Promise<string> {
    const client = await getAuthenticatedClient();
    
    log('github.repo.create.start', { repoName: projectName });
    const { data: repo } = await client.repos.createInOrg({
        org: GITHUB_OWNER,
        name: projectName,
        private: true,
    });
    log('github.repo.create.success', { repoName: repo.name });

    log('github.repo.permission.start', { repoName: repo.name, teamSlug });
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER,
        owner: GITHUB_OWNER,
        team_slug: teamSlug,
        repo: repo.name,
        permission: 'admin',
    });
    log('github.repo.permission.success', { repoName: repo.name, teamSlug });

    return repo.html_url;
}

export async function deleteGithubRepo(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.repo.delete.start', { repoName });
    try {
        await client.repos.delete({
            owner: GITHUB_OWNER,
            repo: repoName,
        });
        log('github.repo.delete.success', { repoName });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.repo.delete.already_gone', { repoName });
            return;
        }
        log('github.repo.delete.error', { repoName, error: error.message });
        throw new Error(`Failed to delete GitHub repo '${repoName}': ${error.message}`);
    }
}

// --- NEW TEAM DELETE FUNCTION ---
export async function deleteGithubTeam(teamSlug: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.team.delete.start', { teamSlug });
    try {
        await client.teams.deleteInOrg({
            org: GITHUB_OWNER,
            team_slug: teamSlug,
        });
        log('github.team.delete.success', { teamSlug });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.team.delete.already_gone', { teamSlug });
            return;
        }
        log('github.team.delete.error', { teamSlug, error: error.message });
        throw new Error(`Failed to delete GitHub team '${teamSlug}': ${error.message}`);
    }
}

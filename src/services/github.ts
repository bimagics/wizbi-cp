import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";
import { log } from '../routes/projects';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
let octokit: Octokit;

async function getAuthenticatedClient(): Promise<Octokit> {
    if (octokit) return octokit;

    log('github.auth.start');
    const appId = await getSecret('GITHUB_APP_ID');
    const privateKey = await getSecret('GITHUB_PRIVATE_KEY');
    const installationId = await getSecret('GITHUB_INSTALLATION_ID');
    
    const auth = createAppAuth({ appId, privateKey, installationId: Number(installationId) });
    const { token } = await auth({ type: "installation" });

    octokit = new Octokit({ auth: token });
    log('github.auth.success');
    return octokit;
}

export async function createGithubTeam(orgName: string): Promise<{ id: number; slug: string }> {
    const client = await getAuthenticatedClient();
    const teamName = `${orgName} Admins`;
    log('github.team.create.start', { orgName, teamName });
    
    const { data: team } = await client.teams.create({ org: GITHUB_OWNER, name: teamName, privacy: 'closed' });
    
    log('github.team.create.success', { teamId: team.id, teamSlug: team.slug });
    return { id: team.id, slug: team.slug };
}

export async function createGithubRepo(projectName: string, teamSlug: string): Promise<string> {
    const client = await getAuthenticatedClient();
    log('github.repo.create.start', { projectName, teamSlug });

    const { data: repo } = await client.repos.createInOrg({
        org: GITHUB_OWNER,
        name: projectName,
        private: true,
    });
    log('github.repo.create.success', { repoName: repo.name });
    
    log('github.repo.permission.start', { repoName: repo.name, teamSlug });
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER,
        team_slug: teamSlug,
        repo: repo.name,
        permission: 'admin',
    });
    log('github.repo.permission.success', { repoName: repo.name, teamSlug });

    return repo.html_url;
}

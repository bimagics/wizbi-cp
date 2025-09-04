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
    
    const { data: repo } = await client.repos.createInOrg({
        org: GITHUB_OWNER,
        name: projectName,
        private: true,
    });
    
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER,
        owner: GITHUB_OWNER, // THIS WAS THE MISSING PARAMETER
        team_slug: teamSlug,
        repo: repo.name,
        permission: 'admin',
    });

    return repo.html_url;
}

import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';

let octokit: Octokit;

async function getAuthenticatedClient(): Promise<Octokit> {
    if (octokit) return octokit;

    const appId = await getSecret('GITHUB_APP_ID');
    const privateKey = await getSecret('GITHUB_PRIVATE_KEY');
    const installationId = await getSecret('GITHUB_INSTALLATION_ID');

    const auth = createAppAuth({
        appId,
        privateKey,
        installationId: Number(installationId),
    });

    const installationAuthentication = await auth({ type: "installation" });

    octokit = new Octokit({ auth: installationAuthentication.token });
    return octokit;
}

export async function createGithubTeam(orgName: string): Promise<number> {
    const client = await getAuthenticatedClient();
    const slug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    const { data: team } = await client.teams.create({
        org: GITHUB_OWNER,
        name: `${orgName} Admins`,
        privacy: 'closed',
    });
    return team.id;
}

export async function createGithubRepo(projectName: string, teamId: number): Promise<string> {
    const client = await getAuthenticated_client();
    
    const { data: repo } = await client.repos.createInOrg({
        org: GITHUB_OWNER,
        name: projectName,
        private: true,
    });
    
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        owner: GITHUB_OWNER,
        org: GITHUB_OWNER,
        team_slug: (await client.teams.getById({ team_id: teamId })).data.slug,
        repo: repo.name,
        permission: 'admin',
    });

    return repo.html_url;
}

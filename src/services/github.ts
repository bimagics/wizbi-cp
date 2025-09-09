// --- REPLACE THE ENTIRE FILE CONTENT ---
// File path: src/services/github.ts

import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";
import { log } from '../routes/projects';
import sodium from 'libsodium-wrappers';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'bimagics';
const TEMPLATE_PREFIX = 'template-'; // Convention for identifying template repos

let octokit: Octokit;

// --- Interfaces ---
interface GitHubTeam { id: number; slug: string; }
interface GitHubRepo { name: string; url: string; }
interface RepoSecrets { [key: string]: string; }
interface ProjectData {
    id: string;
    displayName: string;
    gcpRegion: string;
}
export interface TemplateInfo { name: string; description: string | null; url: string; }

// --- Helper Functions ---

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

async function pollUntilRepoIsReady(client: Octokit, repoName: string, maxRetries = 5, delay = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await client.repos.getContent({ owner: GITHUB_OWNER, repo: repoName, path: 'README.md' });
            log('github.repo.poll.success', { repoName, attempt: i + 1 });
            return;
        } catch (error: any) {
            if (error.status === 404) {
                log('github.repo.poll.not_ready', { repoName, attempt: i + 1, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`Repository ${repoName} was not ready after ${maxRetries} attempts.`);
}


// --- Core Functions ---

export async function listTemplateRepos(): Promise<TemplateInfo[]> {
    const client = await getAuthenticatedClient();
    log('github.templates.list.start', { owner: GITHUB_OWNER });
    const { data: repos } = await client.repos.listForOrg({ org: GITHUB_OWNER, type: 'private' });
    const templates = repos
        .filter(repo => repo.name.startsWith(TEMPLATE_PREFIX))
        .map(repo => ({ name: repo.name, description: repo.description, url: repo.html_url }));
    log('github.templates.list.success', { count: templates.length });
    return templates;
}

export async function createNewTemplate(newTemplateName: string, description: string): Promise<GitHubRepo> {
    const client = await getAuthenticatedClient();
    const baseTemplateRepo = 'template-base';
    const newRepoName = `template-${newTemplateName}`;

    try {
        log('github.template.create.start', { newRepoName, baseTemplate: baseTemplateRepo });
        const { data: repo } = await client.repos.createUsingTemplate({
            template_owner: GITHUB_OWNER, template_repo: baseTemplateRepo,
            owner: GITHUB_OWNER, name: newRepoName, description: description, private: true,
        });
        log('github.template.create.success', { repoName: repo.name });
        
        await pollUntilRepoIsReady(client, newRepoName);

        log('github.template.update.start', { repoName: newRepoName });
        await client.repos.update({ owner: GITHUB_OWNER, repo: newRepoName, is_template: true });
        log('github.template.update.success', { repoName: newRepoName });

        await customizeFileContent(newRepoName, 'package.json', { name: newRepoName });

        log('github.branch.create.start', { repoName: newRepoName, branch: 'dev' });
        const { data: mainBranch } = await client.git.getRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'heads/main' });
        await client.git.createRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'refs/heads/dev', sha: mainBranch.object.sha });
        log('github.branch.create.success', { repoName: newRepoName, branch: 'dev' });

        return { name: repo.name, url: repo.html_url };
    } catch (error: any) {
        if (error.status === 404) {
            log('github.template.create.error.not_found', { baseTemplateRepo });
            throw new Error(`Base template repository '${baseTemplateRepo}' not found or the GitHub App does not have permission to access it.`);
        }
        log('github.template.create.error.unknown', { error: error.message });
        throw error;
    }
}

export async function updateTemplateDescription(repoName: string, newDescription: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.template.update.start', { repoName });
    await client.repos.update({ owner: GITHUB_OWNER, repo: repoName, description: newDescription });
    log('github.template.update.success', { repoName });
}

export async function createGithubTeam(orgName: string): Promise<GitHubTeam> {
    const client = await getAuthenticatedClient();
    const slug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    log('github.team.create.start', { orgName, slug });
    const { data: team } = await client.teams.create({ org: GITHUB_OWNER, name: `${orgName} Admins`, privacy: 'closed' });
    log('github.team.create.success', { teamId: team.id, teamSlug: team.slug });
    return { id: team.id, slug: team.slug };
}

export async function createGithubRepoFromTemplate(project: ProjectData, teamSlug: string, templateRepo: string): Promise<GitHubRepo> {
    const client = await getAuthenticatedClient();
    const newRepoName = project.id;

    log('github.repo.create_from_template.start', { newRepoName, template: templateRepo });
    const { data: repo } = await client.repos.createUsingTemplate({
        template_owner: GITHUB_OWNER, template_repo: templateRepo,
        owner: GITHUB_OWNER, name: newRepoName, private: true,
    });
    log('github.repo.create_from_template.success', { repoName: repo.name });

    await pollUntilRepoIsReady(client, newRepoName);

    log('github.repo.permission.start', { repoName: repo.name, teamSlug });
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER, team_slug: teamSlug, owner: GITHUB_OWNER,
        repo: repo.name, permission: 'admin',
    });
    log('github.repo.permission.success', { repoName: repo.name });
    
    log('github.branch.create.start', { repoName: newRepoName, branch: 'dev' });
    const { data: mainBranch } = await client.git.getRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'heads/main' });
    await client.git.createRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'refs/heads/dev', sha: mainBranch.object.sha });
    log('github.branch.create.success', { repoName: newRepoName, branch: 'dev' });

    log('github.repo.customize.start', { repoName: repo.name });
    await customizeFileContent(repo.name, 'README.md', project);
    await customizeFileContent(repo.name, 'firebase.json', project);
    log('github.repo.customize.success', { repoName: repo.name });

    return { name: repo.name, url: repo.html_url };
}

async function customizeFileContent(repoName: string, filePath: string, replacements: Partial<ProjectData & { name: string }>) {
    const client = await getAuthenticatedClient();
    try {
        log('github.file.get.start', { repoName, filePath });
        const { data: file } = await client.repos.getContent({ owner: GITHUB_OWNER, repo: repoName, path: filePath });
        if (!('content' in file)) throw new Error(`Could not read content of ${filePath}`);

        let content = Buffer.from(file.content, 'base64').toString('utf8');
        
        if (filePath === 'package.json' && replacements.name) {
            const pkg = JSON.parse(content);
            pkg.name = replacements.name;
            content = JSON.stringify(pkg, null, 2);
        } else {
            if (replacements.id) content = content.replace(/\{\{PROJECT_ID\}\}/g, replacements.id);
            if (replacements.displayName) content = content.replace(/\{\{PROJECT_DISPLAY_NAME\}\}/g, replacements.displayName);
            if (replacements.gcpRegion) content = content.replace(/\{\{GCP_REGION\}\}/g, replacements.gcpRegion);
        }

        log('github.file.update.start', { repoName, filePath });
        await client.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER, repo: repoName, path: filePath,
            message: `feat(wizbi): auto-customize ${filePath}`,
            content: Buffer.from(content).toString('base64'),
            sha: file.sha,
        });
        log('github.file.update.success', { repoName, filePath });
    } catch (error: any) {
        if (error.status !== 404) {
             log('github.file.customize.error', { repoName, filePath, error: error.message });
             throw error;
        }
    }
}

export async function createRepoSecrets(repoName: string, secrets: RepoSecrets): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.secrets.create.start', { repoName, secrets: Object.keys(secrets) });
    const { data: publicKey } = await client.actions.getRepoPublicKey({ owner: GITHUB_OWNER, repo: repoName });
    await sodium.ready;
    for (const secretName in secrets) {
        const secretValue = secrets[secretName];
        const messageBytes = Buffer.from(secretValue);
        const keyBytes = Buffer.from(publicKey.key, 'base64');
        const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
        const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');
        await client.actions.createOrUpdateRepoSecret({
            owner: GITHUB_OWNER, repo: repoName, secret_name: secretName,
            encrypted_value: encryptedBase64,
            key_id: publicKey.key_id,
        });
        log('github.secrets.create.success', { repoName, secretName });
    }
}

export async function triggerInitialDeployment(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.workflow.trigger.start', { repoName });
    try {
        await client.actions.createWorkflowDispatch({
            owner: GITHUB_OWNER,
            repo: repoName,
            workflow_id: 'deploy.yml',
            ref: 'main'
        });
        log('github.workflow.trigger.success', { repoName, branch: 'main' });
        
        await client.actions.createWorkflowDispatch({
            owner: GITHUB_OWNER,
            repo: repoName,
            workflow_id: 'deploy.yml',
            ref: 'dev'
        });
        log('github.workflow.trigger.success', { repoName, branch: 'dev' });
    } catch (error: any) {
        log('github.workflow.trigger.error', { repoName, error: error.message });
    }
}

export async function deleteGithubRepo(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.repo.delete.start', { repoName });
    try {
        await client.repos.delete({ owner: GITHUB_OWNER, repo: repoName });
        log('github.repo.delete.success', { repoName });
    } catch (error: any) {
        if (error.status === 404) log('github.repo.delete.already_gone', { repoName });
        else throw new Error(`Failed to delete GitHub repo '${repoName}': ${error.message}`);
    }
}

export async function deleteGithubTeam(teamSlug: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.team.delete.start', { teamSlug });
    try {
        await client.teams.deleteInOrg({ org: GITHUB_OWNER, team_slug: teamSlug });
        log('github.team.delete.success', { teamSlug });
    } catch (error: any) {
        if (error.status === 404) log('github.team.delete.already_gone', { teamSlug });
        else throw new Error(`Failed to delete GitHub team '${teamSlug}': ${error.message}`);
    }
}

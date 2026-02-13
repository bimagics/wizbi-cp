// src/services/github.ts
// GitHub App integration: repos, teams, templates, and secrets.

import { Octokit } from '@octokit/rest';
import { getSecret } from './secrets';
import { createAppAuth } from "@octokit/auth-app";
import { log } from '../routes/projects';
import sodium from 'libsodium-wrappers';

const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
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
    log('github.auth.init.start');
    const appId = await getSecret('GITHUB_APP_ID');
    const privateKey = await getSecret('GITHUB_PRIVATE_KEY');
    const installationId = await getSecret('GITHUB_INSTALLATION_ID');
    const auth = await createAppAuth({ appId: Number(appId), privateKey, installationId: Number(installationId) });
    const { token } = await auth({ type: "installation" });
    octokit = new Octokit({ auth: token });
    log('github.auth.init.success');
    return octokit;
}

async function pollUntilRepoIsReady(client: Octokit, repoName: string, maxRetries = 10, delay = 5000) {
    log('github.repo.poll.start', { repoName, maxRetries, delay });
    for (let i = 0; i < maxRetries; i++) {
        try {
            // More robust check: try to get the main branch. This fails if the repo is still empty.
            await client.git.getRef({ owner: GITHUB_OWNER, repo: repoName, ref: 'heads/main' });
            log('github.repo.poll.success_content_ready', { repoName, attempt: i + 1 });
            return;
        } catch (error: any) {
            if (error.status === 404 || error.status === 409) { // 404 = repo not found, 409 = repo empty
                log('github.repo.poll.not_ready_retrying', { repoName, attempt: i + 1, status: error.status });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                log('github.repo.poll.error', { repoName, error: error.message });
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
        log('github.template.create.attempt', { newRepoName, baseTemplateRepo, description });
        const { data: repo } = await client.repos.createUsingTemplate({
            template_owner: GITHUB_OWNER, template_repo: baseTemplateRepo,
            owner: GITHUB_OWNER, name: newRepoName, description: description, private: true,
        });
        log('github.template.create.success', { repoName: repo.name, url: repo.html_url });

        // **BUG FIX**: Use the improved polling function to wait for content
        await pollUntilRepoIsReady(client, newRepoName);

        log('github.template.update_to_template.attempt', { repoName: newRepoName });
        await client.repos.update({ owner: GITHUB_OWNER, repo: newRepoName, is_template: true });
        log('github.template.update_to_template.success', { repoName: newRepoName });

        await customizeFileContent(newRepoName, 'package.json', { name: newRepoName });

        log('github.branch.dev.create.attempt', { repoName: newRepoName });
        const { data: mainBranch } = await client.git.getRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'heads/main' });
        await client.git.createRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'refs/heads/dev', sha: mainBranch.object.sha });
        log('github.branch.dev.create.success', { repoName: newRepoName });

        return { name: repo.name, url: repo.html_url };
    } catch (error: any) {
        log('github.template.create.error', { newRepoName, error: error.message });
        if (error.status === 404) {
            throw new Error(`Base template repository '${baseTemplateRepo}' not found.`);
        }
        throw error;
    }
}

export async function updateTemplateDescription(repoName: string, newDescription: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.template.description.update.attempt', { repoName, newDescription });
    await client.repos.update({ owner: GITHUB_OWNER, repo: repoName, description: newDescription });
    log('github.template.description.update.success', { repoName });
}

export async function createGithubTeam(orgName: string): Promise<GitHubTeam> {
    const client = await getAuthenticatedClient();
    const teamName = `${orgName} Admins`;
    log('github.team.create.attempt', { orgName, teamName });
    const { data: team } = await client.teams.create({ org: GITHUB_OWNER, name: teamName, privacy: 'closed' });
    log('github.team.create.success', { teamId: team.id, teamSlug: team.slug });
    return { id: team.id, slug: team.slug };
}

export async function createGithubRepoFromTemplate(project: ProjectData, teamSlug: string, templateRepo: string): Promise<GitHubRepo> {
    const client = await getAuthenticatedClient();
    const newRepoName = project.id;

    log('github.repo.create.attempt', { newRepoName, templateRepo, owner: GITHUB_OWNER });
    const { data: repo } = await client.repos.createUsingTemplate({
        template_owner: GITHUB_OWNER, template_repo: templateRepo,
        owner: GITHUB_OWNER, name: newRepoName, private: true,
    });
    log('github.repo.create.success', { repoName: repo.name, url: repo.html_url });

    await pollUntilRepoIsReady(client, newRepoName);

    log('github.repo.permissions.grant.attempt', { repoName: repo.name, teamSlug, permission: 'admin' });
    await client.teams.addOrUpdateRepoPermissionsInOrg({
        org: GITHUB_OWNER, team_slug: teamSlug, owner: GITHUB_OWNER,
        repo: repo.name, permission: 'admin',
    });
    log('github.repo.permissions.grant.success', { repoName: repo.name });

    log('github.branch.dev.create.attempt', { repoName: newRepoName });
    const { data: mainBranch } = await client.git.getRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'heads/main' });
    await client.git.createRef({ owner: GITHUB_OWNER, repo: newRepoName, ref: 'refs/heads/dev', sha: mainBranch.object.sha });
    log('github.branch.dev.create.success', { repoName: newRepoName });

    const filesToCustomize = ['README.md', 'firebase.json', '.env.example'];
    const branchesToUpdate = ['main', 'dev'];

    log('github.repo.customize.start', { repoName: repo.name, files: filesToCustomize, branches: branchesToUpdate });
    for (const branch of branchesToUpdate) {
        for (const file of filesToCustomize) {
            await customizeFileContent(repo.name, file, project, branch);
        }
    }
    log('github.repo.customize.success', { repoName: repo.name });

    return { name: repo.name, url: repo.html_url };
}

async function customizeFileContent(repoName: string, filePath: string, replacements: Partial<ProjectData & { name: string, githubRepoUrl: string }>, branch: string = 'main') {
    const client = await getAuthenticatedClient();
    try {
        log('github.file.get.attempt', { repoName, filePath, branch });
        const { data: file } = await client.repos.getContent({ owner: GITHUB_OWNER, repo: repoName, path: filePath, ref: branch });
        if (!('content' in file) || !file.sha) throw new Error(`Could not read content or SHA of ${filePath} on branch ${branch}`);
        log('github.file.get.success', { repoName, filePath, sha: file.sha, branch });

        let content = Buffer.from(file.content, 'base64').toString('utf8');
        let originalContent = content;

        if (filePath === 'package.json' && replacements.name) {
            const pkg = JSON.parse(content);
            pkg.name = replacements.name;
            content = JSON.stringify(pkg, null, 2);
        } else {
            if (replacements.id) content = content.replace(/\{\{PROJECT_ID\}\}/g, replacements.id);
            if (replacements.displayName) content = content.replace(/\{\{PROJECT_DISPLAY_NAME\}\}/g, replacements.displayName);
            if (replacements.gcpRegion) content = content.replace(/\{\{GCP_REGION\}\}/g, replacements.gcpRegion);
            // Add the new replacement for the GitHub URL
            if (replacements.githubRepoUrl) content = content.replace(/\{\{GITHUB_REPO_URL\}\}/g, replacements.githubRepoUrl);
        }

        if (content === originalContent) {
            log('github.file.update.skipped_no_change', { repoName, filePath, branch });
            return;
        }

        log('github.file.update.attempt', { repoName, filePath, branch, message: `feat(wizbi): auto-customize ${filePath}` });
        await client.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER, repo: repoName, path: filePath,
            message: `feat(wizbi): auto-customize ${filePath}`,
            content: Buffer.from(content).toString('base64'),
            sha: file.sha,
            branch: branch
        });
        log('github.file.update.success', { repoName, filePath, branch });

        // Special log for local environment setup
        if (filePath === '.env.example') {
            log('github.local_env.customized', { repoName, branch, message: 'Local environment template (.env.example) has been customized with project-specific values' });
        }
    } catch (error: any) {
        if (error.status === 404) {
            log('github.file.customize.warn_not_found', { repoName, filePath, branch });
        } else {
            log('github.file.customize.error', { repoName, filePath, error: error.message, branch });
            throw error;
        }
    }
}
export async function createRepoSecrets(repoName: string, secrets: RepoSecrets): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.secrets.get_public_key.attempt', { repoName });
    const { data: publicKey } = await client.actions.getRepoPublicKey({ owner: GITHUB_OWNER, repo: repoName });
    log('github.secrets.get_public_key.success', { repoName, keyId: publicKey.key_id });

    await sodium.ready;

    log('github.secrets.create.start', { repoName, secret_names: Object.keys(secrets) });
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
    }
    log('github.secrets.create.success', { repoName, count: Object.keys(secrets).length });
}

export async function triggerInitialDeployment(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    const workflow_id = 'deploy.yml';
    log('github.workflow.dispatch.attempt', { repoName, workflow_id, branches: ['main', 'dev'] });
    try {
        await client.actions.createWorkflowDispatch({ owner: GITHUB_OWNER, repo: repoName, workflow_id, ref: 'main' });
        await client.actions.createWorkflowDispatch({ owner: GITHUB_OWNER, repo: repoName, workflow_id, ref: 'dev' });
        log('github.workflow.dispatch.success', { repoName });
    } catch (error: any) {
        log('github.workflow.dispatch.error', { repoName, error: error.message });
    }
}

export async function deleteGithubRepo(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.repo.delete.attempt', { repoName });
    try {
        await client.repos.delete({ owner: GITHUB_OWNER, repo: repoName });
        log('github.repo.delete.success', { repoName });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.repo.delete.already_gone', { repoName });
        } else {
            log('github.repo.delete.error', { repoName, error: error.message });
            throw new Error(`Failed to delete GitHub repo '${repoName}': ${error.message}`);
        }
    }
}

// --- NEW ---
export async function deleteTemplateRepo(repoName: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.template.delete.attempt', { repoName });
    try {
        await client.repos.delete({ owner: GITHUB_OWNER, repo: repoName });
        log('github.template.delete.success', { repoName });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.template.delete.already_gone', { repoName });
        } else {
            log('github.template.delete.error', { repoName, error: error.message });
            throw new Error(`Failed to delete GitHub template repo '${repoName}': ${error.message}`);
        }
    }
}

export async function deleteGithubTeam(teamSlug: string): Promise<void> {
    const client = await getAuthenticatedClient();
    log('github.team.delete.attempt', { teamSlug });
    try {
        await client.teams.deleteInOrg({ org: GITHUB_OWNER, team_slug: teamSlug });
        log('github.team.delete.success', { teamSlug });
    } catch (error: any) {
        if (error.status === 404) {
            log('github.team.delete.already_gone', { teamSlug });
        } else {
            log('github.team.delete.error', { teamSlug, error: error.message });
            throw new Error(`Failed to delete GitHub team '${teamSlug}': ${error.message}`);
        }
    }
}

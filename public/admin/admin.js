// --- REPLACE THE ENTIRE FILE CONTENT ---
// This is the full and final code for admin.js
document.addEventListener('DOMContentLoaded', () => {
    const firebaseAuth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    let idToken = null;
    let userProfile = null;
    let activeProjectPollers = {};

    const ICONS = {
        PROJECTS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`,
        ORGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>`,
        USERS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292"></path></svg>`,
        GITHUB: `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`,
        GCP: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.0001 2.00015C11.598 2.00015 11.2012 2.11265 10.8543 2.32523L3.14511 6.8249C2.45076 7.25143 2 8.02008 2 8.8471V15.1532C2 15.9802 2.45076 16.7489 3.14511 17.1754L10.8543 21.6751C11.2012 21.8876 11.598 22.0002 12.0001 22.0002C12.4022 22.0002 12.799 21.8876 13.1459 21.6751L20.8551 17.1754C21.5495 16.7489 22.0002 15.9802 22.0002 15.1532V8.8471C22.0002 8.02008 21.5495 7.25143 20.8551 6.8249L13.1459 2.32523C12.799 2.11265 12.4022 2.00015 12.0001 2.00015ZM12.0001 3.8643L19.071 8.00015L12.0001 12.1361L4.9292 8.00015L12.0001 3.8643ZM11.0001 13.2323V19.932L4.35411 15.8232L11.0001 13.2323ZM13.0001 13.2323L19.6461 15.8232L13.0001 19.932V13.2323Z"/></svg>`,
        DELETE: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
        EDIT: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`,
        ERROR: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px; color: var(--error-color);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
        LOGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
    };

    const DOM = {
        loginContainer: document.getElementById('loginContainer'),
        unauthorizedContainer: document.getElementById('unauthorizedContainer'),
        adminPanelContainer: document.getElementById('adminPanelContainer'),
        userEmail: document.getElementById('userEmail'),
        btnLogin: document.getElementById('btnLogin'),
        btnLogoutAdmin: document.getElementById('btnLogoutAdmin'),
        btnLogoutUnauthorized: document.getElementById('btnLogoutUnauthorized'),
        sidebarNav: document.getElementById('sidebarNav'),
        tabs: {},
        userEditModal: document.getElementById('userEditModal'),
        userEditModalTitle: document.getElementById('userEditModalTitle'),
        userEditForm: document.getElementById('userEditForm'),
        userEditUid: document.getElementById('userEditUid'),
        userEditSuperAdmin: document.getElementById('userEditSuperAdmin'),
        userEditOrgs: document.getElementById('userEditOrgs'),
        logsModal: document.getElementById('logsModal'),
        logsModalTitle: document.getElementById('logsModalTitle'),
        logsModalContent: document.getElementById('logsModalContent'),
        projectOrgId: document.getElementById('projectOrgId'),
        projectShortName: document.getElementById('projectShortName'),
        fullProjectIdPreview: document.getElementById('fullProjectIdPreview'),
    };
    
    // --- Core Functions ---
    const showView = (viewName) => {
        ['loginContainer', 'unauthorizedContainer', 'adminPanelContainer'].forEach(id => {
            DOM[id].classList.toggle('hidden', id !== viewName);
        });
    };

    const callApi = async (path, options = {}) => {
        if (!idToken) throw new Error('Not authenticated');
        const response = await fetch(`/api${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', 'X-Firebase-ID-Token': idToken, ...(options.headers || {}) }
        });
        const responseData = await response.json().catch(() => ({ ok: false, error: 'Failed to parse JSON response' }));
        if (!response.ok) throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
        return responseData;
    };
    
    firebaseAuth.onAuthStateChanged(async (user) => {
        Object.values(activeProjectPollers).forEach(clearInterval);
        activeProjectPollers = {};
        if (user) {
            idToken = await user.getIdToken();
            try {
                userProfile = await callApi('/me');
                DOM.userEmail.textContent = user.email;
                if (userProfile.roles?.superAdmin || (userProfile.roles?.orgAdmin?.length > 0)) {
                    showView('adminPanelContainer');
                    setupDashboard();
                } else {
                    showView('unauthorizedContainer');
                }
            } catch (error) {
                console.error('Session initialization failed.', error);
                firebaseAuth.signOut();
            }
        } else {
            idToken = null;
            userProfile = null;
            showView('loginContainer');
        }
    });
    
    function setupDashboard() {
        const navItems = [{ id: 'Projects', icon: ICONS.PROJECTS }, { id: 'Orgs', icon: ICONS.ORGS }, { id: 'Users', icon: ICONS.USERS, adminOnly: true }];
        DOM.sidebarNav.innerHTML = '';
        navItems.forEach(item => {
            if (item.adminOnly && !userProfile.roles?.superAdmin) return;
            const button = document.createElement('button');
            button.id = `btnTab${item.id}`;
            button.className = 'nav-button';
            button.innerHTML = `${item.icon}<span>${item.id}</span>`;
            button.addEventListener('click', () => switchTab(item.id));
            DOM.sidebarNav.appendChild(button);
            DOM.tabs[`tabContent${item.id}`] = document.getElementById(`tabContent${item.id}`);
        });
        switchTab('Projects');
        loadAllData();
        loadTemplates(); 
    }
    
    function switchTab(tabId) {
        Object.values(DOM.tabs).forEach(tab => tab.classList.add('hidden'));
        document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
        DOM.tabs[`tabContent${tabId}`].classList.remove('hidden');
        document.getElementById(`btnTab${tabId}`).classList.add('active');
    }
    
    // --- Data Loading & Rendering ---
    let projectsCache = [], orgsCache = [], usersCache = [], templatesCache = [];

    async function loadAllData() {
        await Promise.all([loadOrgs(), loadProjects()]);
        if (userProfile.roles?.superAdmin) await loadUsers();
    }
    
    async function loadProjects() {
        try {
            const newProjects = await callApi('/projects');
            const newProjectIds = new Set(newProjects.map(p => p.id));
            Object.keys(activeProjectPollers).forEach(projectId => {
                if (!newProjectIds.has(projectId)) {
                    stopProjectPolling(projectId);
                }
            });
            projectsCache = newProjects;
            renderProjectsTable(projectsCache);
        } catch(e) { console.error("Failed to load projects", e); }
    }
    async function loadOrgs() {
        try {
            const { items } = await callApi('/orgs');
            orgsCache = items;
            renderOrgsTable(items);
            updateOrgDropdown(items);
        } catch(e) { console.error("Failed to load orgs", e); }
    }
    async function loadUsers() {
        if (!userProfile.roles?.superAdmin) return;
        try { usersCache = await callApi('/users'); renderUsersTable(usersCache); } catch(e) { console.error("Failed to load users", e); }
    }

    async function loadTemplates() {
        try {
            const { templates } = await callApi('/github/templates');
            templatesCache = templates;
            const select = document.getElementById('projectTemplate');
            select.innerHTML = '<option value="" disabled selected>Select a Template</option>' + 
                templates.map(t => `<option value="${t.name}">${t.name.replace(/-/g, ' ')} (${t.description || 'No description'})</option>`).join('');
        } catch (e) {
            console.error("Failed to load templates", e);
            const select = document.getElementById('projectTemplate');
            select.innerHTML = '<option value="" disabled selected>Error loading templates</option>';
        }
    }

    function renderProjectsTable(projects) {
        const tbody = document.getElementById('projectsTable').querySelector('tbody');
        tbody.innerHTML = projects.length === 0 ? `<tr><td colspan="6">No projects found.</td></tr>` : projects.map(p => {
            const newRow = document.createElement('tr');
            newRow.id = `project-row-${p.id}`;
            newRow.innerHTML = generateProjectRowHTML(p);
            if (isProjectInProcess(p.state)) {
                startProjectPolling(p.id);
            }
            return newRow.outerHTML;
        }).join('');
    }

    function generateProjectRowHTML(p) {
        const state = p.state || 'N/A';
        const isFailed = state.startsWith('failed');
        const inProcess = isProjectInProcess(state);
        const progress = getProgressForState(state);
        
        return `
            <td data-label="Display Name">${p.displayName}</td>
            <td data-label="Project ID">${p.id}</td>
            <td data-label="Status" class="status-cell">
                <div class="status-indicator">
                    <div class="status-text ${state}">${state.replace(/_/g, ' ')}</div>
                    ${isFailed ? `<span class="error-tooltip" title="${p.error || 'Unknown error'}">${ICONS.ERROR}</span>` : ''}
                </div>
                <div class="progress-bar ${inProcess ? '' : 'hidden'}">
                    <div class="progress-bar-inner" style="width: ${progress.percent}%;"></div>
                </div>
                <div class="progress-text ${inProcess ? '' : 'hidden'}">${progress.text}</div>
            </td>
            <td data-label="Links" class="links-cell"><div class="links-cell-content">
                ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/home/dashboard?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="GCP Console">${ICONS.GCP}</a>` : ''}
                ${p.githubRepoUrl ? `<a href="${p.githubRepoUrl}" target="_blank" class="icon-button" title="GitHub Repo">${ICONS.GITHUB}</a>` : ''}
            </div></td>
            <td data-label="Created">${new Date(p.createdAt).toLocaleDateString()}</td>
            <td data-label="Actions" class="actions-cell"><div class="actions-cell-content">
                <button class="icon-button logs" data-action="show-logs" data-id="${p.id}" title="Show Logs">${ICONS.LOGS}</button>
                ${renderProjectActions(p)}
            </div></td>
        `;
    }

    function renderProjectActions(project) {
        if (!userProfile.roles?.superAdmin || isProjectInProcess(project.state)) return '';
        if (project.state !== 'ready') {
            return `<button class="btn btn-primary btn-sm" data-action="provision-all" data-id="${project.id}">Provision All</button>`;
        }
        return `<button class="icon-button delete" data-type="project" data-id="${project.id}" title="Delete Project">${ICONS.DELETE}</button>`;
    }
    
    const renderOrgsTable = (orgs) => {
        const tbody = document.getElementById('orgsTable').querySelector('tbody');
        tbody.innerHTML = orgs.length === 0 ? `<tr><td colspan="5">No organizations found.</td></tr>` : orgs.map(org => `
            <tr>
                <td data-label="Name">${org.name}</td> <td data-label="ID">${org.id}</td> <td data-label="Phone">${org.phone || 'N/A'}</td>
                <td data-label="Created">${new Date(org.createdAt).toLocaleDateString()}</td>
                <td data-label="Actions" class="actions-cell"><div class="actions-cell-content">
                   ${userProfile.roles?.superAdmin ? `<button class="icon-button delete" data-type="org" data-id="${org.id}" data-name="${org.name}" title="Delete Organization">${ICONS.DELETE}</button>`: ''}
                </div></td>
            </tr>`).join('');
    };

    const renderUsersTable = (users) => {
        const tbody = document.getElementById('usersTable').querySelector('tbody');
        tbody.innerHTML = users.length === 0 ? `<tr><td colspan="4">No users found.</td></tr>` : users.map(user => {
            const role = user.roles?.superAdmin ? 'Super Admin' : (user.roles?.orgAdmin?.length > 0 ? 'Org Admin' : 'No Role');
            const orgNames = (user.roles?.orgAdmin || []).map(orgId => orgsCache.find(o => o.id === orgId)?.name || orgId).join(', ');
            return `
                <tr>
                    <td data-label="Email">${user.email}</td> <td data-label="Role">${role}</td> <td data-label="Orgs">${orgNames || 'N/A'}</td>
                    <td data-label="Actions" class="actions-cell"><div class="actions-cell-content"><button class="icon-button" data-action="edit-user" data-uid="${user.uid}" title="Edit User Roles">${ICONS.EDIT}</button></div></td>
                </tr>`;
        }).join('');
    };

    const updateOrgDropdown = (orgs) => {
        const select = document.getElementById('projectOrgId');
        select.innerHTML = '<option value="" disabled selected>Select an Organization</option>' + orgs.map(org => `<option value="${org.id}">${org.name}</option>`).join('');
    };

    // --- Event Listeners ---
    DOM.btnLogin.addEventListener('click', () => firebaseAuth.signInWithPopup(googleProvider));
    [DOM.btnLogoutAdmin, DOM.btnLogoutUnauthorized].forEach(btn => btn.addEventListener('click', () => firebaseAuth.signOut()));
    document.getElementById('btnShowCreateOrg').addEventListener('click', () => document.getElementById('formCreateOrgCard').classList.toggle('hidden'));
    document.getElementById('btnShowProvisionProject').addEventListener('click', () => document.getElementById('formProvisionProjectCard').classList.toggle('hidden'));
    
    document.getElementById('formCreateOrg').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.orgName.value.trim();
        if(!name) return;
        try {
            await callApi('/orgs', { method: 'POST', body: JSON.stringify({ name, phone: e.target.elements.orgPhone.value.trim() }) });
            e.target.reset(); document.getElementById('formCreateOrgCard').classList.add('hidden'); await loadOrgs();
        } catch (error) { alert(`Error: ${error.message}`); }
    });

    document.getElementById('formProvisionProject').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { projectOrgId, projectShortName, projectDisplayName, projectTemplate } = e.target.elements;
        if (!projectOrgId.value || !projectShortName.value || !projectDisplayName.value || !projectTemplate.value) return;
        const body = { 
            orgId: projectOrgId.value, 
            shortName: projectShortName.value.trim(), 
            displayName: projectDisplayName.value.trim(),
            template: projectTemplate.value
        };
        try {
            await callApi('/projects', { method: 'POST', body: JSON.stringify(body) });
            e.target.reset();
            DOM.fullProjectIdPreview.value = '';
            document.getElementById('formProvisionProjectCard').classList.add('hidden');
            await loadProjects();
        } catch (error) { 
            alert(`Failed to create project entry: ${error.message}`);
        }
    });

    [DOM.projectOrgId, DOM.projectShortName].forEach(el => {
        el.addEventListener('input', updateProjectIdPreview);
    });

    function updateProjectIdPreview() {
        const orgId = DOM.projectOrgId.value;
        const shortName = DOM.projectShortName.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!orgId || !shortName) {
            DOM.fullProjectIdPreview.value = '';
            return;
        }
        const selectedOrg = orgsCache.find(o => o.id === orgId);
        if (!selectedOrg) return;
        const orgSlug = (selectedOrg.name || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        DOM.fullProjectIdPreview.value = `wizbi-${orgSlug}-${shortName}`;
    }
    
    document.getElementById('adminPanelContainer').addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action], button.delete');
        if (!button) return;
        const { action, id, uid, type, name } = button.dataset;
        if (action === 'provision-all') handleFullProvisioning(id);
        else if (action === 'show-logs') showLogsForProject(id);
        else if (action === 'edit-user') { const user = usersCache.find(u => u.uid === uid); if (user) openUserEditModal(user); }
        else if (type === 'project' || type === 'org') {
             if (confirm(`FINAL CONFIRMATION: Are you sure you want to delete ${type} '${name || id}'? This is irreversible.`)) {
                try {
                    await callApi(`/${type}s/${id}`, { method: 'DELETE' });
                    loadAllData();
                } catch (error) { alert(`Failed to delete ${type}: ${error.message}`); }
            }
        }
    });

    // --- Modals & State Management ---
    const openModal = (modalId) => document.getElementById(modalId).classList.remove('hidden');
    const closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');
    document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close)));

    const openUserEditModal = (user) => {
        DOM.userEditModalTitle.textContent = `Edit: ${user.email}`;
        DOM.userEditUid.value = user.uid;
        DOM.userEditSuperAdmin.checked = user.roles?.superAdmin === true;
        DOM.userEditOrgs.innerHTML = orgsCache.map(org => `<div class="checkbox-item"><input type="checkbox" id="org-${org.id}" value="${org.id}" ${user.roles?.orgAdmin?.includes(org.id) ? 'checked' : ''}><label for="org-${org.id}">${org.name}</label></div>`).join('');
        openModal('userEditModal');
    };
    
    DOM.userEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = DOM.userEditUid.value;
        const roles = { superAdmin: DOM.userEditSuperAdmin.checked, orgAdmin: Array.from(DOM.userEditOrgs.querySelectorAll('input:checked')).map(input => input.value) };
        try { await callApi(`/users/${uid}`, { method: 'PUT', body: JSON.stringify({ roles }) }); closeModal('userEditModal'); await loadUsers(); } catch (error) { alert(`Error: ${error.message}`); }
    });

    async function showLogsForProject(projectId) {
        DOM.logsModalTitle.textContent = `Logs for: ${projectId}`;
        DOM.logsModalContent.innerHTML = '<div class="spinner" style="display:block;"></div>';
        openModal('logsModal');
        try {
            const { logs } = await callApi(`/projects/${projectId}/logs`);
            DOM.logsModalContent.innerHTML = logs.length > 0 ? logs.map(log => {
                const { ts, evt, ...meta } = log;
                const isError = evt.includes('error') || evt.includes('fail');
                let metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
                return `<div class="log-entry"><span class="log-timestamp">${new Date(ts).toLocaleTimeString()}</span><span class="log-event ${isError ? 'log-event-error' : ''}">${evt}</span><pre class="log-meta">${metaString}</pre></div>`;
            }).join('') : 'No logs found.';
        } catch (error) {
            DOM.logsModalContent.innerHTML = `<span class="log-meta-error">Could not load logs: ${error.message}</span>`;
        }
    }
    
    // --- Automated Provisioning Logic ---
    function isProjectInProcess(state) {
        return state && (state.startsWith('provisioning') || state.startsWith('injecting') || state.startsWith('pending_'));
    }

    function getProgressForState(state) {
        const states = {
            'pending_gcp': { percent: 10, text: 'Queued for GCP setup' },
            'provisioning_gcp': { percent: 25, text: 'Provisioning GCP Project...' },
            'pending_github': { percent: 50, text: 'Queued for GitHub setup' },
            'provisioning_github': { percent: 65, text: 'Creating GitHub Repo...' },
            'pending_secrets': { percent: 80, text: 'Queued for finalization' },
            'injecting_secrets': { percent: 90, text: 'Injecting secrets...' },
            'ready': { percent: 100, text: 'Completed' },
        };
        return states[state] || { percent: 0, text: 'Status unknown' };
    }

    function startProjectPolling(projectId) {
        if (activeProjectPollers[projectId]) return;
        activeProjectPollers[projectId] = setInterval(() => pollProjectStatus(projectId), 5000);
    }

    function stopProjectPolling(projectId) {
        if (activeProjectPollers[projectId]) {
            clearInterval(activeProjectPollers[projectId]);
            delete activeProjectPollers[projectId];
        }
    }

    async function pollProjectStatus(projectId) {
        try {
            const project = await callApi(`/projects/${projectId}`);
            const index = projectsCache.findIndex(p => p.id === projectId);
            if (index > -1) projectsCache[index] = project;
            else projectsCache.push(project);
            
            const row = document.getElementById(`project-row-${projectId}`);
            if (row) row.innerHTML = generateProjectRowHTML(project);

            if (!isProjectInProcess(project.state)) {
                stopProjectPolling(projectId);
            } else {
                const nextAction = getNextActionForState(project.state);
                if (nextAction) {
                    await callApi(`/projects/${projectId}/${nextAction}`, { method: 'POST' });
                }
            }
        } catch (error) {
            console.error(`Polling failed for ${projectId}:`, error);
            stopProjectPolling(projectId);
            const row = document.getElementById(`project-row-${projectId}`);
            if (row) {
                const statusCell = row.querySelector('.status-cell');
                if (statusCell) statusCell.innerHTML += `<div class="error-text">Polling failed.</div>`;
            }
        }
    }
    
    function getNextActionForState(state) {
        const transitions = {
            'pending_gcp': 'provision-gcp',
            'pending_github': 'provision-github',
            'pending_secrets': 'finalize'
        };
        return transitions[state] || null;
    }

    async function handleFullProvisioning(projectId) {
        try {
            const project = projectsCache.find(p => p.id === projectId);
            if (!project) throw new Error('Project not found in cache.');
            const firstAction = getNextActionForState(project.state);
            if (!firstAction) { alert('Project is in a state that cannot be actioned.'); return; }
            await callApi(`/projects/${projectId}/${firstAction}`, { method: 'POST' });
            startProjectPolling(projectId);
        } catch (error) { alert(`Failed to start provisioning: ${error.message}`); }
    }
});

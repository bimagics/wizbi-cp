document.addEventListener('DOMContentLoaded', () => {
    const firebaseAuth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    let idToken = null;
    let projectsRefreshInterval = null;

    const DOM = {
        loginContainer: document.getElementById('loginContainer'),
        unauthorizedContainer: document.getElementById('unauthorizedContainer'),
        adminPanelContainer: document.getElementById('adminPanelContainer'),
        userEmail: document.getElementById('userEmail'),
        btnLogin: document.getElementById('btnLogin'),
        btnLogoutAdmin: document.getElementById('btnLogoutAdmin'),
        btnLogoutUnauthorized: document.getElementById('btnLogoutUnauthorized'),
        btnTabProjects: document.getElementById('btnTabProjects'),
        btnTabOrgs: document.getElementById('btnTabOrgs'),
        tabContentProjects: document.getElementById('tabContentProjects'),
        tabContentOrgs: document.getElementById('tabContentOrgs'),
        formCreateOrg: document.getElementById('formCreateOrg'),
        orgsSpinner: document.getElementById('orgsSpinner'),
        orgsTableBody: document.getElementById('orgsTable').querySelector('tbody'),
        formProvisionProject: document.getElementById('formProvisionProject'),
        projectsSpinner: document.getElementById('projectsSpinner'),
        projectsTableBody: document.getElementById('projectsTable').querySelector('tbody'),
        projectOrgIdSelect: document.getElementById('projectOrgId'),
        projectIdInput: document.getElementById('projectId'),
        statusLog: document.getElementById('statusLog'),
    };

    const log = (message, isError = false) => {
        DOM.statusLog.textContent = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
        DOM.statusLog.classList.toggle('error', isError);
    };

    const showView = (viewName) => {
        ['loginContainer', 'unauthorizedContainer', 'adminPanelContainer'].forEach(id => {
            DOM[id].classList.toggle('hidden', id !== viewName);
        });
    };

    const callApi = async (path, options = {}) => {
        if (!idToken) throw new Error('Not authenticated');
        try {
            const response = await fetch(`/api${path}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Firebase-ID-Token': idToken,
                    ...(options.headers || {})
                }
            });
            const responseData = await response.json().catch(() => ({
                error: 'Failed to parse JSON response'
            }));
            if (!response.ok) {
                throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
            }
            return responseData;
        } catch (error) {
            log(`API Error on ${path}: ${error.message}`, true);
            throw error;
        }
    };

    const loadAdminDashboard = async () => {
        log('Admin authorized. Loading dashboard data...');
        try {
            await Promise.all([loadOrgs(), loadProjects()]);
            log('Dashboard loaded successfully.');
        } catch (e) {
            log('Failed to load dashboard data. Please check permissions and network.', true);
        }
    };

    firebaseAuth.onAuthStateChanged(async (user) => {
        if (user) {
            DOM.userEmail.textContent = user.email;
            idToken = await user.getIdToken();
            try {
                const userProfile = await callApi('/me');
                if (userProfile.roles?.superAdmin === true) {
                    showView('adminPanelContainer');
                    await loadAdminDashboard();
                } else {
                    showView('unauthorizedContainer');
                }
            } catch (error) {
                log('Session initialization failed. You have been logged out.', true);
                firebaseAuth.signOut();
                showView('loginContainer');
            }
        } else {
            idToken = null;
            showView('loginContainer');
            if (projectsRefreshInterval) clearInterval(projectsRefreshInterval);
        }
    });

    DOM.btnLogin.addEventListener('click', () => firebaseAuth.signInWithPopup(googleProvider));
    [DOM.btnLogoutAdmin, DOM.btnLogoutUnauthorized].forEach(btn => btn.addEventListener('click', () => firebaseAuth.signOut()));

    const switchTab = (activeTab) => {
        const isProjects = activeTab === 'projects';
        DOM.btnTabProjects.classList.toggle('active', isProjects);
        DOM.tabContentProjects.classList.toggle('active', isProjects);
        DOM.btnTabOrgs.classList.toggle('active', !isProjects);
        DOM.tabContentOrgs.classList.toggle('active', !isProjects);
    };
    DOM.btnTabProjects.addEventListener('click', () => switchTab('projects'));
    DOM.btnTabOrgs.addEventListener('click', () => switchTab('orgs'));

    // --- RENDER FUNCTIONS ---
    const renderProjectsTable = (projects) => {
        const tbody = DOM.projectsTableBody;
        tbody.innerHTML = '';
        if (!projects || projects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7">No projects found.</td></tr>`;
            return;
        }

        const GITHUB_ICON = `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;
        const GCP_ICON = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.28 15.25c-3.14-.14-5.6-2.2-5.6-4.53 0-2.03 1.57-3.8 4.2-4.51l.26-.07.13.28c.39.84.99 2.08 1.01 2.1.06.15.22.26.39.26s.33-.11.39-.26c.02-.02.62-1.26 1.01-2.1l.13-.28.26.07c2.63.71 4.2 2.47 4.2 4.51 0 2.33-2.46 4.39-5.6 4.53-.28.01-.52-.2-.52-.47v-.01c0-.26.23-.47.49-.47 2.28-.13 4.09-1.5 4.09-3.08s-1.81-2.94-4.09-3.08c-.26 0-.49-.21-.49-.47v-.01c0-.26.23-.47.49-.47 2.28-.13 4.09-1.5 4.09-3.08s-1.81-2.94-4.09-3.08c-2.28.13-4.09 1.5-4.09 3.08s1.81 2.94 4.09 3.08c.26 0 .49.21.49.47v.01c0 .26-.23.47-.49.47-2.28.13-4.09 1.5-4.09 3.08s1.81 2.94 4.09 3.08c.26 0 .49.21.49.47v.01c0 .26-.23.47-.49-.47z"></path></svg>`;
        const DELETE_ICON = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"></path></svg>`;

        projects.forEach(p => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${p.id}</td>
                <td>${p.displayName}</td>
                <td>${p.orgId}</td>
                <td class="state-cell">
                    <div class="state-cell-text ${p.state}">${p.state}</div>
                    ${(p.state === 'starting' || p.state === 'provisioning' || p.state === 'deleting') ? '<div class="spinner spinner-inline" style="display: block;"></div>' : ''}
                    ${p.state === 'failed' || p.state === 'delete_failed' ? `<div class="state-cell-error" title="${p.error}">⚠️</div>` : ''}
                </td>
                <td class="links-cell">
                    ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/home/dashboard?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="Open in GCP Console">${GCP_ICON}</a>` : ''}
                    ${p.githubRepoUrl ? `<a href="${p.githubRepoUrl}" target="_blank" class="icon-button" title="Open in GitHub">${GITHUB_ICON}</a>` : ''}
                </td>
                <td>${new Date(p.createdAt).toLocaleString()}</td>
                <td class="actions-cell">
                    <button class="icon-button delete" data-type="project" data-id="${p.id}" title="Delete Project">${DELETE_ICON}</button>
                </td>
            `;
        });
    };

    const renderOrgsTable = (orgs) => {
        const tbody = DOM.orgsTableBody;
        tbody.innerHTML = '';
        if (!orgs || orgs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No organizations found.</td></tr>`;
            return;
        }
        const DELETE_ICON = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"></path></svg>`;

        orgs.forEach(org => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${org.id}</td>
                <td>${org.name}</td>
                <td>${org.phone || 'N/A'}</td>
                <td>${new Date(org.createdAt).toLocaleString()}</td>
                <td class="actions-cell">
                    <button class="icon-button delete" data-type="org" data-id="${org.id}" title="Delete Organization (not implemented yet)" disabled>${DELETE_ICON}</button>
                </td>
            `;
        });
    };

    // --- DATA LOADING ---
    let orgsCache = [];
    const loadOrgs = async () => {
        DOM.orgsSpinner.style.display = 'block';
        try {
            const { items } = await callApi('/orgs');
            orgsCache = items;
            renderOrgsTable(items);
            
            const currentOrg = DOM.projectOrgIdSelect.value;
            DOM.projectOrgIdSelect.innerHTML = '<option value="" disabled selected>Select an Organization</option>';
            items.forEach(org => {
                const option = document.createElement('option');
                option.value = org.id;
                option.textContent = org.name;
                option.dataset.name = org.name;
                DOM.projectOrgIdSelect.appendChild(option);
            });
            if(currentOrg) DOM.projectOrgIdSelect.value = currentOrg;

        } finally {
            DOM.orgsSpinner.style.display = 'none';
        }
    };

    const loadProjects = async () => {
        DOM.projectsSpinner.style.display = 'block';
        try {
            const items = await callApi('/projects');
            renderProjectsTable(items);

            const isProcessing = items.some(p => ['starting', 'provisioning', 'deleting'].includes(p.state));
            if (isProcessing && !projectsRefreshInterval) {
                projectsRefreshInterval = setInterval(loadProjects, 10000);
            } else if (!isProcessing && projectsRefreshInterval) {
                clearInterval(projectsRefreshInterval);
                projectsRefreshInterval = null;
            }

        } finally {
            DOM.projectsSpinner.style.display = 'none';
        }
    };

    // --- EVENT LISTENERS ---
    DOM.formCreateOrg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.orgName.value.trim();
        const phone = e.target.elements.orgPhone.value.trim();
        if(!name) {
            log('Organization name is required.', true);
            return;
        }
        log(`Creating new organization: ${name}...`);
        try {
            await callApi('/orgs', {
                method: 'POST',
                body: JSON.stringify({ name, phone })
            });
            log('Organization created successfully!');
            DOM.formCreateOrg.reset();
            await loadOrgs();
        } catch (error) { /* error is already logged by callApi */ }
    });

    DOM.projectOrgIdSelect.addEventListener('change', (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const orgName = selectedOption.dataset.name;
        if (orgName) {
            const sanitizedOrgName = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const randomSuffix = Math.floor(100 + Math.random() * 900);
            DOM.projectIdInput.value = `${sanitizedOrgName}-${randomSuffix}`;
        }
    });

    DOM.formProvisionProject.addEventListener('submit', async (e) => {
        e.preventDefault();
        const orgId = e.target.elements.projectOrgId.value;
        const projectId = e.target.elements.projectId.value.trim();
        const displayName = e.target.elements.projectDisplayName.value.trim();

        if (!orgId || !projectId || !displayName) {
           log('All fields are required to provision a project.', true);
           return;
        }
        if (projectId.length < 6) {
            log('Project ID must be at least 6 characters long.', true);
            return;
        }
        if (!/^[a-z0-9-]+$/.test(projectId)) {
            log('Project ID can only contain lowercase letters, numbers, and hyphens.', true);
            return;
        }

        if (!confirm(`Provision new project '${displayName}' with ID '${projectId}'?`)) return;
        
        log(`Starting provisioning for '${projectId}'...`);
        try {
            await callApi('/projects', {
                method: 'POST',
                body: JSON.stringify({ orgId, projectId, displayName })
            });
            log('Project provisioning accepted. The table will update automatically.');
            DOM.formProvisionProject.reset();
            await loadProjects();
        } catch (error) { /* error is already logged by callApi */ }
    });

    // --- DELEGATED EVENT LISTENER FOR DELETE BUTTONS ---
    document.getElementById('adminPanelContainer').addEventListener('click', async (e) => {
        const target = e.target.closest('.icon-button.delete');
        if (!target) return;

        const type = target.dataset.type;
        const id = target.dataset.id;

        if (type === 'project') {
            if (confirm(`Are you sure you want to delete project '${id}'? This will delete the GCP project and the GitHub repo.`) &&
                confirm(`FINAL CONFIRMATION: This action is irreversible. Delete project '${id}'?`)) {
                log(`Starting deletion for project '${id}'...`);
                try {
                    await callApi(`/projects/${id}`, { method: 'DELETE' });
                    log(`Deletion process for project '${id}' has been initiated.`);
                    await loadProjects();
                } catch (error) { /* error is already logged by callApi */ }
            }
        }
    });
});

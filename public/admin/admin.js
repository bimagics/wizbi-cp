document.addEventListener('DOMContentLoaded', () => {
    const firebaseAuth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    let idToken = null;
    let userProfile = null;
    let projectsRefreshInterval = null;

    const ICONS = {
        PROJECTS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`,
        ORGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>`,
        USERS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292"></path></svg>`,
        GITHUB: `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`,
        GCP: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.0001 2.00015C11.598 2.00015 11.2012 2.11265 10.8543 2.32523L3.14511 6.8249C2.45076 7.25143 2 8.02008 2 8.8471V15.1532C2 15.9802 2.45076 16.7489 3.14511 17.1754L10.8543 21.6751C11.2012 21.8876 11.598 22.0002 12.0001 22.0002C12.4022 22.0002 12.799 21.8876 13.1459 21.6751L20.8551 17.1754C21.5495 16.7489 22.0002 15.9802 22.0002 15.1532V8.8471C22.0002 8.02008 21.5495 7.25143 20.8551 6.8249L13.1459 2.32523C12.799 2.11265 12.4022 2.00015 12.0001 2.00015ZM12.0001 3.8643L19.071 8.00015L12.0001 12.1361L4.9292 8.00015L12.0001 3.8643ZM11.0001 13.2323V19.932L4.35411 15.8232L11.0001 13.2323ZM13.0001 13.2323L19.6461 15.8232L13.0001 19.932V13.2323Z"/></svg>`,
        DELETE: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
        EDIT: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`,
        ERROR: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px; color: var(--error-color);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
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
        statusLog: document.getElementById('statusLog'),
        tabs: {},
        userEditModal: document.getElementById('userEditModal'),
        userEditModalTitle: document.getElementById('userEditModalTitle'),
        closeUserEditModal: document.getElementById('closeUserEditModal'),
        userEditForm: document.getElementById('userEditForm'),
        userEditUid: document.getElementById('userEditUid'),
        userEditSuperAdmin: document.getElementById('userEditSuperAdmin'),
        userEditOrgs: document.getElementById('userEditOrgs'),
        cancelUserEdit: document.getElementById('cancelUserEdit'),
        saveUserEdit: document.getElementById('saveUserEdit'),
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
                headers: { 'Content-Type': 'application/json', 'X-Firebase-ID-Token': idToken, ...(options.headers || {}) }
            });
            const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));
            if (!response.ok) throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
            return responseData;
        } catch (error) {
            log(`API Error on ${path}: ${error.message}`, true);
            throw error;
        }
    };
    
    firebaseAuth.onAuthStateChanged(async (user) => {
        clearInterval(projectsRefreshInterval);
        projectsRefreshInterval = null;
        if (user) {
            idToken = await user.getIdToken();
            try {
                userProfile = await callApi('/me');
                DOM.userEmail.textContent = user.email;
                if (userProfile.roles?.superAdmin || (userProfile.roles?.orgAdmin && userProfile.roles.orgAdmin.length > 0)) {
                    showView('adminPanelContainer');
                    setupDashboard();
                } else {
                    showView('unauthorizedContainer');
                }
            } catch (error) {
                log('Session initialization failed. Logging out.', true);
                firebaseAuth.signOut();
            }
        } else {
            idToken = null;
            userProfile = null;
            showView('loginContainer');
        }
    });
    
    const setupDashboard = () => {
        const navItems = [
            { id: 'Projects', icon: ICONS.PROJECTS, load: loadProjects, adminOnly: false },
            { id: 'Orgs', icon: ICONS.ORGS, load: loadOrgs, adminOnly: false },
            { id: 'Users', icon: ICONS.USERS, load: loadUsers, adminOnly: true }
        ];

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
        loadOrgs();
        loadProjects();
        if (userProfile.roles?.superAdmin) {
            loadUsers();
        }
        
        document.getElementById('btnShowCreateOrg').classList.toggle('hidden', !userProfile.roles?.superAdmin);
    };
    
    const switchTab = (tabId) => {
        Object.values(DOM.tabs).forEach(tab => tab.classList.add('hidden'));
        document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
        
        DOM.tabs[`tabContent${tabId}`].classList.remove('hidden');
        document.getElementById(`btnTab${tabId}`).classList.add('active');
    };
    
    let orgsCache = [];
    const loadOrgs = async () => {
        const spinner = document.getElementById('orgsSpinner');
        spinner.style.display = 'block';
        try {
            const { items } = await callApi('/orgs');
            orgsCache = items;
            renderOrgsTable(items);
            updateOrgDropdown(items);
        } finally {
            spinner.style.display = 'none';
        }
    };
    
    const loadProjects = async () => {
        const spinner = document.getElementById('projectsSpinner');
        spinner.style.display = 'block';
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
            spinner.style.display = 'none';
        }
    };

    let usersCache = [];
    const loadUsers = async () => {
        if (!userProfile.roles?.superAdmin) return;
        const spinner = document.getElementById('usersSpinner');
        spinner.style.display = 'block';
        try {
            const items = await callApi('/users');
            usersCache = items;
            renderUsersTable(items);
        } finally {
            spinner.style.display = 'none';
        }
    };

    const renderProjectsTable = (projects) => {
        const tbody = document.getElementById('projectsTable').querySelector('tbody');
        tbody.innerHTML = projects.length === 0 ? `<tr><td colspan="7">No projects found.</td></tr>` : projects.map(p => {
            const isFailed = ['failed', 'delete_failed'].includes(p.state);
            return `
            <tr>
                <td>${p.displayName}</td>
                <td>${p.id}</td>
                <td>${p.orgId}</td>
                <td class="state-cell">
                    <div class="state-cell-text ${p.state}">${p.state || 'N/A'}</div>
                    ${['starting', 'provisioning', 'deleting'].includes(p.state) ? '<div class="spinner spinner-inline" style="display: block;"></div>' : ''}
                    ${isFailed ? `<span class="error-tooltip" title="${p.error || 'Unknown error'}">${ICONS.ERROR}</span>` : ''}
                </td>
                <td class="links-cell">
                    ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/home/dashboard?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="Open in GCP Console">${ICONS.GCP}</a>` : ''}
                    ${p.githubRepoUrl ? `<a href="${p.githubRepoUrl}" target="_blank" class="icon-button" title="Open in GitHub">${ICONS.GITHUB}</a>` : ''}
                </td>
                <td>${new Date(p.createdAt).toLocaleDateString()}</td>
                <td class="actions-cell">
                    ${userProfile.roles?.superAdmin ? `<button class="icon-button delete" data-type="project" data-id="${p.id}" title="Delete Project">${ICONS.DELETE}</button>` : ''}
                </td>
            </tr>
        `}).join('');
    };
    
    const renderOrgsTable = (orgs) => {
        const tbody = document.getElementById('orgsTable').querySelector('tbody');
        tbody.innerHTML = orgs.length === 0 ? `<tr><td colspan="5">No organizations found.</td></tr>` : orgs.map(org => `
            <tr>
                <td>${org.name}</td>
                <td>${org.id}</td>
                <td>${org.phone || 'N/A'}</td>
                <td>${new Date(org.createdAt).toLocaleDateString()}</td>
                <td class="actions-cell">
                   ${userProfile.roles?.superAdmin ? `<button class="icon-button delete" data-type="org" data-id="${org.id}" data-name="${org.name}" title="Delete Organization">${ICONS.DELETE}</button>`: ''}
                </td>
            </tr>
        `).join('');
    };

    const renderUsersTable = (users) => {
        const tbody = document.getElementById('usersTable').querySelector('tbody');
        tbody.innerHTML = users.length === 0 ? `<tr><td colspan="4">No users found.</td></tr>` : users.map(user => {
            const role = user.roles?.superAdmin ? 'Super Admin' : (user.roles?.orgAdmin?.length > 0 ? 'Org Admin' : 'No Role');
            const orgNames = (user.roles?.orgAdmin || [])
                .map(orgId => orgsCache.find(o => o.id === orgId)?.name || orgId)
                .join(', ');
            return `
                <tr>
                    <td>${user.email}</td>
                    <td>${role}</td>
                    <td>${orgNames || 'N/A'}</td>
                    <td class="actions-cell">
                        <button class="icon-button" data-action="edit-user" data-uid="${user.uid}" title="Edit User Roles">${ICONS.EDIT}</button>
                    </td>
                </tr>
            `;
        }).join('');
    };
    
    const updateOrgDropdown = (orgs) => {
        const select = document.getElementById('projectOrgId');
        const currentVal = select.value;
        select.innerHTML = '<option value="" disabled selected>Select an Organization</option>' + orgs.map(org => `<option value="${org.id}" data-name="${org.name}">${org.name}</option>`).join('');
        if (currentVal) select.value = currentVal;
    };
    
    DOM.btnLogin.addEventListener('click', () => firebaseAuth.signInWithPopup(googleProvider));
    [DOM.btnLogoutAdmin, DOM.btnLogoutUnauthorized].forEach(btn => btn.addEventListener('click', () => firebaseAuth.signOut()));

    document.getElementById('btnShowCreateOrg').addEventListener('click', () => document.getElementById('formCreateOrgCard').classList.toggle('hidden'));
    document.getElementById('btnShowProvisionProject').addEventListener('click', () => document.getElementById('formProvisionProjectCard').classList.toggle('hidden'));
    
    document.getElementById('formCreateOrg').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.orgName.value.trim();
        const phone = e.target.elements.orgPhone.value.trim();
        if(!name) { log('Organization name is required.', true); return; }
        log(`Creating organization: ${name}...`);
        try {
            await callApi('/orgs', { method: 'POST', body: JSON.stringify({ name, phone }) });
            log('Organization created successfully!');
            e.target.reset();
            document.getElementById('formCreateOrgCard').classList.add('hidden');
            await loadOrgs();
        } catch (error) {}
    });

    document.getElementById('formProvisionProject').addEventListener('submit', async (e) => {
        e.preventDefault();
        const orgId = e.target.elements.projectOrgId.value;
        const projectId = e.target.elements.projectId.value.trim();
        const displayName = e.target.elements.projectDisplayName.value.trim();
        if (!orgId || !projectId || !displayName) { log('All fields are required.', true); return; }
        if (!confirm(`Provision new project '${displayName}'?`)) return;
        log(`Starting provisioning for '${projectId}'...`);
        try {
            await callApi('/projects', { method: 'POST', body: JSON.stringify({ orgId, projectId, displayName }) });
            log('Project provisioning accepted.');
            e.target.reset();
            document.getElementById('formProvisionProjectCard').classList.add('hidden');
            await loadProjects();
        } catch (error) {}
    });
    
    document.getElementById('adminPanelContainer').addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.icon-button.delete');
        const editUserBtn = e.target.closest('.icon-button[data-action="edit-user"]');

        if (deleteBtn) {
            const { type, id, name } = deleteBtn.dataset;
            if (confirm(`FINAL CONFIRMATION: Are you sure you want to delete ${type} '${name || id}'? This is irreversible.`)) {
                log(`Initiating deletion for ${type} '${id}'...`);
                try {
                    await callApi(`/${type}s/${id}`, { method: 'DELETE' });
                    log(`Deletion started for ${type} '${id}'.`);
                    type === 'project' ? await loadProjects() : await loadOrgs();
                } catch (error) {}
            }
        }
        
        if (editUserBtn) {
            const uid = editUserBtn.dataset.uid;
            const user = usersCache.find(u => u.uid === uid);
            if (user) openUserEditModal(user);
        }
    });

    const openUserEditModal = (user) => {
        DOM.userEditModalTitle.textContent = `Edit: ${user.email}`;
        DOM.userEditUid.value = user.uid;
        DOM.userEditSuperAdmin.checked = user.roles?.superAdmin === true;
        
        DOM.userEditOrgs.innerHTML = orgsCache.map(org => `
            <div class="checkbox-item">
                <input type="checkbox" id="org-${org.id}" value="${org.id}" ${user.roles?.orgAdmin?.includes(org.id) ? 'checked' : ''}>
                <label for="org-${org.id}">${org.name}</label>
            </div>
        `).join('');
        
        DOM.userEditModal.classList.remove('hidden');
    };
    
    const closeUserEditModal = () => DOM.userEditModal.classList.add('hidden');
    
    DOM.closeUserEditModal.addEventListener('click', closeUserEditModal);
    DOM.cancelUserEdit.addEventListener('click', closeUserEditModal);
    
    DOM.userEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = DOM.userEditUid.value;
        const isSuperAdmin = DOM.userEditSuperAdmin.checked;
        const orgAdminOf = Array.from(DOM.userEditOrgs.querySelectorAll('input:checked')).map(input => input.value);
        
        const updatedRoles = {
            superAdmin: isSuperAdmin,
            orgAdmin: orgAdminOf
        };
        
        log(`Updating user ${uid}...`);
        try {
            await callApi(`/users/${uid}`, { method: 'PUT', body: JSON.stringify({ roles: updatedRoles }) });
            log('User updated successfully!');
            closeUserEditModal();
            await loadUsers();
        } catch (error) {}
    });
});

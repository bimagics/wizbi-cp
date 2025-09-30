// --- REPLACE THE ENTIRE FILE CONTENT ---
// This is the full and final code for admin.js, with all requested features.
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
        TEMPLATES: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>`,
        GITHUB: `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`,
        CLOUDRUN: `<svg width="800px" height="800px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path fill="#EA4335" d="M10.313 5.376l1.887-1.5-.332-.414a5.935 5.935 0 00-5.586-1.217 5.89 5.89 0 00-3.978 4.084c-.03.113.312-.098.463-.056l2.608-.428s.127-.124.201-.205c1.16-1.266 3.126-1.432 4.465-.354l.272.09z"/><path fill="#4285F4" d="M13.637 6.3a5.835 5.835 0 00-1.77-2.838l-1.83 1.82a3.226 3.226 0 011.193 2.564v.323c.9 0 1.63.725 1.63 1.62 0 .893-.73 1.619-1.63 1.619l-3.257-.003-.325.035v2.507l.325.053h3.257a4.234 4.234 0 004.08-2.962A4.199 4.199 0 0013.636 6.3z"/><path fill="#34A853" d="M4.711 13.999H7.97v-2.594H4.71c-.232 0-.461-.066-.672-.161l-.458.14-1.313 1.297-.114.447a4.254 4.254 0 002.557.87z"/><path fill="#FBBC05" d="M4.711 5.572A4.234 4.234 0 00.721 8.44a4.206 4.206 0 001.433 4.688l1.89-1.884a1.617 1.617 0 01.44-3.079 1.63 1.63 0 011.714.936l1.89-1.878A4.24 4.24 0 004.71 5.572z"/></svg>`,
        LINK: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`,
        DELETE: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
        EDIT: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`,
        ERROR: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px; color: var(--error-color);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
        LOGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
        RETRY: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 19v-5h-5M4 19h5v-5M20 4h-5v5"/></svg>`,
        BILLING: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>`,
        DOCS: `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 512 512" style="enable-background:new 0 0 512 512;" xml:space="preserve">
<path style="fill:#167EE6;" d="M439.652,512H72.348c-9.217,0-16.696-7.479-16.696-16.696V16.696C55.652,7.479,63.131,0,72.348,0
	h233.739c4.424,0,8.674,1.761,11.804,4.892l133.565,133.565c3.131,3.13,4.892,7.379,4.892,11.804v345.043
	C456.348,504.521,448.869,512,439.652,512z"/>
<path style="fill:#2860CC;" d="M317.891,4.892C314.761,1.761,310.511,0,306.087,0H256v512h183.652
	c9.217,0,16.696-7.479,16.696-16.696V150.261c0-4.424-1.761-8.674-4.892-11.804L317.891,4.892z"/>
<path style="fill:#167EE6;" d="M451.459,138.459L317.891,4.892C314.76,1.76,310.511,0,306.082,0h-16.691l0.001,150.261
	c0,9.22,7.475,16.696,16.696,16.696h150.26v-16.696C456.348,145.834,454.589,141.589,451.459,138.459z"/>
<path style="fill:#FFFFFF;" d="M272.696,411.826H139.13c-9.217,0-16.696-7.479-16.696-16.696c0-9.217,7.479-16.696,16.696-16.696
	h133.565c9.217,0,16.696,7.479,16.696,16.696C289.391,404.348,281.913,411.826,272.696,411.826z"/>
<path style="fill:#E6F3FF;" d="M272.696,378.435H256v33.391h16.696c9.217,0,16.696-7.479,16.696-16.696
	C289.391,385.913,281.913,378.435,272.696,378.435z"/>
<path style="fill:#FFFFFF;" d="M372.87,345.043H139.13c-9.217,0-16.696-7.479-16.696-16.696c0-9.217,7.479-16.696,16.696-16.696
	H372.87c9.217,0,16.696,7.479,16.696,16.696C389.565,337.565,382.087,345.043,372.87,345.043z"/>
<path style="fill:#E6F3FF;" d="M372.87,311.652H256v33.391h116.87c9.217,0,16.696-7.479,16.696-16.696
	C389.565,319.131,382.087,311.652,372.87,311.652z"/>
<path style="fill:#FFFFFF;" d="M372.87,278.261H139.13c-9.217,0-16.696-7.479-16.696-16.696c0-9.217,7.479-16.696,16.696-16.696
	H372.87c9.217,0,16.696,7.479,16.696,16.696C389.565,270.782,382.087,278.261,372.87,278.261z"/>
<path style="fill:#E6F3FF;" d="M372.87,244.87H256v33.391h116.87c9.217,0,16.696-7.479,16.696-16.696
	C389.565,252.348,382.087,244.87,372.87,244.87z"/>
</svg>`,
        DOCS_ADD: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
        FIREBASE: `<svg width="800px" height="800px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><title>file_type_firebase</title><path d="M5.8,24.6l.17-.237L13.99,9.149l.017-.161L10.472,2.348a.656.656,0,0,0-1.227.207Z" style="fill:#ffc24a"/><path d="M5.9,24.42l.128-.25L13.965,9.114,10.439,2.448a.6.6,0,0,0-1.133.206Z" style="fill:#ffa712"/><path d="M16.584,14.01l2.632-2.7L16.583,6.289a.678.678,0,0,0-1.195,0L13.981,8.971V9.2Z" style="fill:#f4bd62"/><path d="M16.537,13.9l2.559-2.62L16.537,6.4a.589.589,0,0,0-1.074-.047L14.049,9.082l-.042.139Z" style="fill:#ffa50e"/><polygon points="5.802 24.601 5.879 24.523 6.158 24.41 16.418 14.188 16.548 13.834 13.989 8.956 5.802 24.601" style="fill:#f6820c"/><path d="M16.912,29.756,26.2,24.577,23.546,8.246A.635.635,0,0,0,22.471,7.9L5.8,24.6l9.233,5.155a1.927,1.927,0,0,0,1.878,0" style="fill:#fde068"/><path d="M26.115,24.534,23.483,8.326a.557.557,0,0,0-.967-.353L5.9,24.569l9.131,5.1a1.912,1.912,0,0,0,1.863,0Z" style="fill:#fcca3f"/><path d="M16.912,29.6a1.927,1.927,0,0,1-1.878,0L5.876,24.522,5.8,24.6l9.233,5.155a1.927,1.927,0,0,0,1.878,0L26.2,24.577l-.023-.14Z" style="fill:#eeab37"/></svg>`,
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
        btnCopyLogs: document.getElementById('btnCopyLogs'),
        projectOrgId: document.getElementById('projectOrgId'),
        projectShortName: document.getElementById('projectShortName'),
        fullProjectIdPreview: document.getElementById('fullProjectIdPreview'),
        templateName: document.getElementById('templateName'),
        fullTemplateNamePreview: document.getElementById('fullTemplateNamePreview'),
        projectsTable: document.getElementById('projectsTable'),
        sidebarToggleDesktop: document.getElementById('sidebarToggleDesktop'),
        hamburgerButton: document.getElementById('hamburgerButton'),
        mobileOverlay: document.getElementById('mobileOverlay'),
        docPreviewModal: document.getElementById('docPreviewModal'),
        docPreviewModalTitle: document.getElementById('docPreviewModalTitle'),
        docPreviewFrame: document.getElementById('docPreviewFrame'),
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
        const navItems = [
            { id: 'Projects', icon: ICONS.PROJECTS }, 
            { id: 'Orgs', icon: ICONS.ORGS }, 
            { id: 'Templates', icon: ICONS.TEMPLATES, adminOnly: true },
            { id: 'Users', icon: ICONS.USERS, adminOnly: true }
        ];
        DOM.sidebarNav.innerHTML = '';
        navItems.forEach(item => {
            if (item.adminOnly && !userProfile.roles?.superAdmin) return;
            const button = document.createElement('button');
            button.id = `btnTab${item.id}`;
            button.className = 'nav-button';
            button.innerHTML = `${item.icon}<span>${item.id}</span>`;
            button.addEventListener('click', () => {
                switchTab(item.id);
                if (window.innerWidth <= 992) {
                    document.body.classList.remove('mobile-menu-open');
                }
            });
            DOM.sidebarNav.appendChild(button);
            DOM.tabs[`tabContent${item.id}`] = document.getElementById(`tabContent${item.id}`);
        });
        switchTab('Projects');
        loadAllData();
        loadTemplatesForProjectForm();
        setupSidebarToggle();
    }
    
    function switchTab(tabId) {
        Object.values(DOM.tabs).forEach(tab => tab.classList.add('hidden'));
        document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
        DOM.tabs[`tabContent${tabId}`].classList.remove('hidden');
        document.getElementById(`btnTab${tabId}`).classList.add('active');
    }

    function setupSidebarToggle() {
        DOM.sidebarToggleDesktop.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebarCollapsed', document.body.classList.contains('sidebar-collapsed'));
        });

        DOM.hamburgerButton.addEventListener('click', () => {
            document.body.classList.toggle('mobile-menu-open');
        });
        DOM.mobileOverlay.addEventListener('click', () => {
            document.body.classList.remove('mobile-menu-open');
        });
        
        if (window.innerWidth > 992 && localStorage.getItem('sidebarCollapsed') === 'true') {
            document.body.classList.add('sidebar-collapsed');
        }
    }
    
    // --- Data Loading & Rendering ---
    let projectsCache = [], orgsCache = [], usersCache = [], templatesCache = [];

    async function loadAllData() {
        await Promise.all([loadOrgs(), loadProjects()]);
        if (userProfile.roles?.superAdmin) {
            await Promise.all([loadUsers(), loadTemplatesData()]);
        }
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

    async function loadTemplatesForProjectForm() {
        try {
            const { templates } = await callApi('/github/templates');
            templatesCache = templates;
            const select = document.getElementById('projectTemplate');
            select.innerHTML = '<option value="" disabled selected>Select a Template</option>' + 
                templates.map(t => `<option value="${t.name}">${t.name.replace('template-', '').replace(/-/g, ' ')} (${t.description || 'No description'})</option>`).join('');
        } catch (e) {
            console.error("Failed to load templates for form", e);
            document.getElementById('projectTemplate').innerHTML = '<option value="" disabled selected>Error loading templates</option>';
        }
    }

    async function loadTemplatesData() {
        if (!userProfile.roles?.superAdmin) return;
        try {
            const { templates } = await callApi('/github/templates');
            renderTemplatesTable(templates);
        } catch (e) {
            console.error("Failed to load templates", e);
            document.getElementById('templatesTable').querySelector('tbody').innerHTML = `<tr><td colspan="4">Error loading templates.</td></tr>`;
        }
    }

    function renderTemplatesTable(templates) {
        const tbody = document.getElementById('templatesTable').querySelector('tbody');
        tbody.innerHTML = templates.length === 0 ? `<tr><td colspan="4">No templates found.</td></tr>` : templates.map(t => `
            <tr>
                <td data-label="Name">${t.name}</td>
                <td data-label="Description">${t.description || 'N/A'}</td>
                <td data-label="Link"><a href="${t.url}" target="_blank" class="icon-button" title="View on GitHub">${ICONS.GITHUB}</a></td>
                <td data-label="Actions" class="actions-cell">
                    <div class="actions-cell-content">
                        <button class="icon-button" data-action="edit-template" data-name="${t.name}" data-description="${t.description || ''}" title="Edit Description">${ICONS.EDIT}</button>
                        <button class="icon-button delete" data-type="template" data-name="${t.name}" title="Delete Template">${ICONS.DELETE}</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderProjectsTable(projects) {
        const tbody = DOM.projectsTable.querySelector('tbody');
        tbody.innerHTML = projects.length === 0 ? `<tr><td colspan="7">No projects found.</td></tr>` : projects.map(p => {
            const org = orgsCache.find(o => o.id === p.orgId);
            const projectWithOrg = { ...p, orgName: org ? org.name : 'N/A' };
            if (isProjectInProcess(p.state) && p.state !== 'pending_billing') {
                startProjectPolling(p.id);
            }
            return generateProjectRowHTML(projectWithOrg);
        }).join('');
    }

    function generateProjectRowHTML(p) {
        const state = p.state || 'N/A';
        const isFailed = state.startsWith('failed');
        const isPendingBilling = state === 'pending_billing';
        const isReady = state === 'ready';
        const inProcess = isProjectInProcess(state);
        const progress = getProgressForState(state);
        const createdDateTime = new Date(p.createdAt).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        
        const billingUrl = `https://console.cloud.google.com/billing/linkedaccount?project=${p.gcpProjectId}`;

        const docButtonHtml = p.specDocUrl 
            ? `<button class="icon-button" data-action="preview-doc" data-url="${p.specDocUrl}" data-name="${p.displayName}" title="Preview Specification Document">${ICONS.DOCS}</button>`
            : `<button class="icon-button" data-action="generate-doc" data-id="${p.id}" title="Generate Specification Document">${ICONS.DOCS_ADD}</button>`;

        return `
            <tr id="project-row-${p.id}">
                <td data-label="Display Name">${p.displayName}</td>
                <td data-label="Organization">${p.orgName}</td>
                <td data-label="Project ID">${p.id}</td>
                <td data-label="Status" class="status-cell">
                    <div class="status-indicator">
                        <div class="status-text ${state}">${state.replace(/_/g, ' ')}</div>
                        ${(isFailed || isPendingBilling) ? `<span class="error-tooltip" title="${p.error || 'Unknown error'}">${ICONS.ERROR}</span>` : ''}
                    </div>
                    <div class="progress-bar ${inProcess && !isPendingBilling ? '' : 'hidden'}">
                        <div class="progress-bar-inner" style="width: ${progress.percent}%;"></div>
                    </div>
                    <div class="progress-text ${inProcess && !isPendingBilling ? '' : 'hidden'}">${progress.text}</div>
                </td>
                <td data-label="Links" class="links-cell"><div class="links-cell-content">
                    ${isPendingBilling ? `<a href="${billingUrl}" target="_blank" class="icon-button billing-link" title="Link Billing Account">${ICONS.BILLING}</a>` : ''}
                    ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/run?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="Cloud Run Services">${ICONS.CLOUDRUN}</a>` : ''}
                    ${p.githubRepoUrl ? `<a href="${p.githubRepoUrl}" target="_blank" class="icon-button" title="GitHub Repo">${ICONS.GITHUB}</a>` : ''}
                    ${p.gcpProjectId ? `<a href="https://console.firebase.google.com/project/${p.gcpProjectId}" target="_blank" class="icon-button" title="Firebase Console">${ICONS.FIREBASE}</a>` : ''}
                    ${docButtonHtml}
                    ${isReady ? `<a href="https://${p.id}.web.app" target="_blank" class="icon-button" title="Production Site">${ICONS.LINK}</a>` : ''}
                    ${isReady ? `<a href="https://${p.id}-qa.web.app" target="_blank" class="icon-button" title="QA Site" style="color: var(--warning-color);">${ICONS.LINK}</a>` : ''}
                </div></td>
                <td data-label="Created">${createdDateTime}</td>
                <td data-label="Actions" class="actions-cell"><div class="actions-cell-content">
                    <button class="icon-button logs" data-action="show-logs" data-id="${p.id}" title="Show Logs">${ICONS.LOGS}</button>
                    ${renderProjectActions(p)}
                </div></td>
            </tr>
        `;
    }

    function renderProjectActions(project) {
        if (!userProfile.roles?.superAdmin) return '';
        const state = project.state;
        const inProcess = isProjectInProcess(state);
        let actionsHtml = '';
        if (state.startsWith('failed') || state === 'pending_billing') {
            actionsHtml += `<button class="btn btn-secondary btn-sm" data-action="provision" data-id="${project.id}" title="Retry Full Provisioning">${ICONS.RETRY} Retry</button>`;
        }
        if (!inProcess) {
             actionsHtml += `<button class="icon-button delete" data-type="project" data-id="${project.id}" title="Delete Project">${ICONS.DELETE}</button>`;
        }
        return actionsHtml;
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
    document.getElementById('btnShowCreateTemplate').addEventListener('click', () => document.getElementById('formCreateTemplateCard').classList.toggle('hidden'));
    
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
            const newProject = await callApi('/projects', { method: 'POST', body: JSON.stringify(body) });
            e.target.reset(); DOM.fullProjectIdPreview.value = '';
            document.getElementById('formProvisionProjectCard').classList.add('hidden');
            await loadProjects();
            startProjectPolling(newProject.id);
        } catch (error) { alert(`Failed to create project entry: ${error.message}`); }
    });

    document.getElementById('formCreateTemplate').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.templateName.value.trim();
        const description = e.target.elements.templateDescription.value.trim();
        if (!name || !description) return;
        try {
            await callApi('/github/templates', { method: 'POST', body: JSON.stringify({ name, description }) });
            e.target.reset(); DOM.fullTemplateNamePreview.value = '';
            document.getElementById('formCreateTemplateCard').classList.add('hidden');
            await loadTemplatesData();
            await loadTemplatesForProjectForm();
        } catch (error) { alert(`Error creating template: ${error.message}`); }
    });

    [DOM.projectOrgId, DOM.projectShortName].forEach(el => el.addEventListener('input', updateProjectIdPreview));
    DOM.templateName.addEventListener('input', updateTemplateNamePreview);

    function updateProjectIdPreview() {
        const orgId = DOM.projectOrgId.value;
        const shortName = DOM.projectShortName.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!orgId || !shortName) { DOM.fullProjectIdPreview.value = ''; return; }
        const selectedOrg = orgsCache.find(o => o.id === orgId);
        if (!selectedOrg) return;
        const orgSlug = (selectedOrg.name || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        DOM.fullProjectIdPreview.value = `wizbi-${orgSlug}-${shortName}`;
    }

    function updateTemplateNamePreview() {
        const shortName = DOM.templateName.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        DOM.fullTemplateNamePreview.value = shortName ? `template-${shortName}` : '';
    }
    
    document.getElementById('adminPanelContainer').addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-action], button[data-type]');
        if (!button) return;

        const { action, id, uid, type, name, description, url } = button.dataset;
        
        if (action === 'provision') {
             try {
                await callApi(`/projects/${id}/provision`, { method: 'POST' });
                startProjectPolling(id);
            } catch (error) {
                alert(`Failed to start provisioning for ${id}: ${error.message}`);
            }
            return;
        }

        if (action === 'generate-doc') {
            try {
                button.innerHTML = '<div class="spinner-small"></div>';
                button.disabled = true;
                await callApi(`/projects/${id}/generate-doc`, { method: 'POST' });
                await pollProjectStatus(id); // Refresh the row
            } catch (error) {
                alert(`Failed to generate document for ${id}: ${error.message}`);
                button.innerHTML = ICONS.DOCS_ADD;
                button.disabled = false;
            }
        } else if (action === 'preview-doc') {
            openDocPreviewModal(name, url);
        } else if (action === 'edit-template') {
            const newDescription = prompt(`Enter new description for:\n${name}`, description);
            if (newDescription !== null && newDescription !== description) {
                try {
                    await callApi(`/github/templates/${name}`, { method: 'PUT', body: JSON.stringify({ description: newDescription }) });
                    await loadTemplatesData();
                    await loadTemplatesForProjectForm();
                } catch (error) { alert(`Failed to update description: ${error.message}`); }
            }
        } else if (action === 'show-logs') {
            showLogsForProject(id);
        } else if (action === 'edit-user') {
            const user = usersCache.find(u => u.uid === uid);
            if (user) openUserEditModal(user);
        } else if (type === 'project' || type === 'org' || type === 'template') {
             const entityId = type === 'template' ? name : id;
             if (confirm(`FINAL CONFIRMATION: Are you sure you want to delete ${type} '${name || id}'? This is irreversible.`)) {
                try {
                    const path = type === 'template' ? `/github/templates/${entityId}` : `/${type}s/${entityId}`;
                    await callApi(path, { method: 'DELETE' });
                    if (type === 'template') {
                        await loadTemplatesData();
                        await loadTemplatesForProjectForm();
                    } else {
                        await loadAllData();
                    }
                } catch (error) { alert(`Failed to delete ${type}: ${error.message}`); }
            }
        }
    });

    // --- Table Sorting ---
    let sortState = { column: 'createdAt', direction: 'desc' };

    DOM.projectsTable.querySelector('thead').addEventListener('click', (e) => {
        const header = e.target.closest('th[data-sortable]');
        if (!header) return;
        
        const column = header.dataset.sortable;
        if (sortState.column === column) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = column;
            sortState.direction = 'asc';
        }
        
        projectsCache.sort((a, b) => {
            const valA = a[column] || '';
            const valB = b[column] || '';
            let comparison = 0;
            if (valA > valB) { comparison = 1; } 
            else if (valA < valB) { comparison = -1; }
            return sortState.direction === 'asc' ? comparison : comparison * -1;
        });

        document.querySelectorAll('#projectsTable th[data-sortable]').forEach(th => th.removeAttribute('data-sort-dir'));
        header.setAttribute('data-sort-dir', sortState.direction);
        renderProjectsTable(projectsCache);
    });
    
    // --- Modals & State Management ---
    const openModal = (modalId) => document.getElementById(modalId).classList.remove('hidden');
    const closeModal = (modalId) => document.getElementById(modalId).classList.add('hidden');
    document.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', () => closeModal(el.dataset.close));
    });
    
    DOM.docPreviewModal.addEventListener('click', (e) => {
        if(e.target === DOM.docPreviewModal) {
            closeModal('docPreviewModal');
        }
    });

    const openUserEditModal = (user) => {
        DOM.userEditModalTitle.textContent = `Edit: ${user.email}`;
        DOM.userEditUid.value = user.uid;
        DOM.userEditSuperAdmin.checked = user.roles?.superAdmin === true;
        DOM.userEditOrgs.innerHTML = orgsCache.map(org => `<div class="checkbox-item"><input type="checkbox" id="org-${org.id}" value="${org.id}" ${user.roles?.orgAdmin?.includes(org.id) ? 'checked' : ''}><label for="org-${org.id}">${org.name}</label></div>`).join('');
        openModal('userEditModal');
    };
    
    const openDocPreviewModal = (projectName, docUrl) => {
        DOM.docPreviewModalTitle.textContent = `Preview: ${projectName}`;
        // Google Docs needs a specific preview URL for embedding
        const previewUrl = docUrl.replace('/edit', '/preview');
        DOM.docPreviewFrame.src = previewUrl;
        openModal('docPreviewModal');
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
            const formattedLogs = logs.map(log => {
                const { ts, evt, serverTimestamp, ...meta } = log;
                const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
                return `[${new Date(ts).toLocaleString()}] ${evt}\n${metaString ? metaString + '\n' : ''}`;
            }).join('---\n');
            
            const htmlLogs = logs.map(log => {
                const { ts, evt, ...meta } = log;
                const isError = evt.includes('error') || evt.includes('fail');
                let metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
                return `<div class="log-entry"><span class="log-timestamp">${new Date(ts).toLocaleTimeString()}</span><span class="log-event ${isError ? 'log-event-error' : ''}">${evt}</span><pre class="log-meta">${metaString}</pre></div>`;
            }).join('');
            
            DOM.logsModalContent.innerHTML = htmlLogs || 'No logs found.';
        } catch (error) {
            DOM.logsModalContent.innerHTML = `<span class="log-meta-error">Could not load logs: ${error.message}</span>`;
        }
    }
    
    // --- Automated Provisioning Logic ---
    function isProjectInProcess(state) {
        return state && (state.startsWith('provisioning') || state.startsWith('injecting') || state.startsWith('pending_') || state.startsWith('deleting'));
    }

    function getProgressForState(state) {
        const states = {
            'pending_gcp': { percent: 10, text: 'Queued for GCP setup' },
            'provisioning_gcp': { percent: 25, text: 'Provisioning GCP Project...' },
            'pending_billing': { percent: 40, text: 'Action Required: Link Billing' },
            'failed_billing': { percent: 40, text: 'Billing setup failed' },
            'failed_gcp': { percent: 40, text: 'GCP setup failed' },
            'pending_github': { percent: 50, text: 'Queued for GitHub setup' },
            'provisioning_github': { percent: 65, text: 'Creating GitHub Repo...' },
            'failed_github': { percent: 75, text: 'GitHub setup failed' },
            'pending_secrets': { percent: 80, text: 'Queued for finalization' },
            'injecting_secrets': { percent: 90, text: 'Injecting secrets...' },
            'failed_secrets': { percent: 95, text: 'Finalization failed' },
            'ready': { percent: 100, text: 'Completed' },
        };
        return states[state] || { percent: 0, text: 'Status unknown' };
    }

    function startProjectPolling(projectId) {
        if (activeProjectPollers[projectId]) return;
        activeProjectPollers[projectId] = setInterval(() => pollProjectStatus(projectId), 7000);
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
            if (index > -1) {
                projectsCache[index] = { ...projectsCache[index], ...project };
            } else {
                projectsCache.push(project);
            }
            
            const org = orgsCache.find(o => o.id === project.orgId);
            const projectWithOrg = { ...project, orgName: org ? org.name : 'N/A' };

            const row = document.getElementById(`project-row-${projectId}`);
            if (row) {
                row.outerHTML = generateProjectRowHTML(projectWithOrg);
            }

            if (!isProjectInProcess(project.state) || project.state === 'pending_billing') {
                stopProjectPolling(projectId);
            }
        } catch (error) {
            console.error(`Polling failed for ${projectId}:`, error);
            stopProjectPolling(projectId);
            const row = document.getElementById(`project-row-${projectId}`);
            if (row) {
                const statusCell = row.querySelector('.status-cell');
                if (statusCell) statusCell.innerHTML += `<div class="error-text">Polling failed. Refresh recommended.</div>`;
            }
        }
    }
});

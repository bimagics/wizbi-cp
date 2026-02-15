// Admin Panel — main application logic.
document.addEventListener('firebase-config-loaded', () => {
    const firebaseAuth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    let idToken = null;
    let userProfile = null;
    let activeProjectPollers = {};

    const ICONS = {
        // Standard Icons
        PROJECTS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`,
        ORGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>`,
        USERS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292"></path></svg>`,
        TEMPLATES: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>`,
        // Action Icons
        DELETE: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`,
        EDIT: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`,
        LOGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
        RETRY: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 19v-5h-5M4 19h5v-5M20 4h-5v5"/></svg>`,
        PLUS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>`,
        // Selectable Link Icons
        LINK: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>`,
        DOCS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`,
        GITHUB: `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`,
        CLOUDRUN: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`,
        FIREBASE: `<svg width="800px" height="800px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><title>Firebase</title><path d="M5.8,24.6l.17-.237L13.99,9.149l.017-.161L10.472,2.348a.656.656,0,0,0-1.227.207Z" style="fill:#ffc24a"/><path d="M5.9,24.42l.128-.25L13.965,9.114,10.439,2.448a.6.6,0,0,0-1.133.206Z" style="fill:#ffa712"/><path d="M16.584,14.01l2.632-2.7L16.583,6.289a.678.678,0,0,0-1.195,0L13.981,8.971V9.2Z" style="fill:#f4bd62"/><path d="M16.537,13.9l2.559-2.62L16.537,6.4a.589.589,0,0,0-1.074-.047L14.049,9.082l-.042.139Z" style="fill:#ffa50e"/><polygon points="5.802 24.601 5.879 24.523 6.158 24.41 16.418 14.188 16.548 13.834 13.989 8.956 5.802 24.601" style="fill:#f6820c"/><path d="M16.912,29.756,26.2,24.577,23.546,8.246A.635.635,0,0,0,22.471,7.9L5.8,24.6l9.233,5.155a1.927,1.927,0,0,0,1.878,0" style="fill:#fde068"/><path d="M26.115,24.534,23.483,8.326a.557.557,0,0,0-.967-.353L5.9,24.569l9.131,5.1a1.912,1.912,0,0,0,1.863,0Z" style="fill:#fcca3f"/><path d="M16.912,29.6a1.927,1.927,0,0,1-1.878,0L5.876,24.522,5.8,24.6l9.233,5.155a1.927,1.927,0,0,0,1.878,0L26.2,24.577l-.023-.14Z" style="fill:#eeab37"/></svg>`,
        CHART: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>`,
        BILLING: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>`,
        EXTERNAL_LINK: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`,
        ERROR: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px; color: var(--error-color);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
        SETTINGS: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`,
        AGENT: `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>`,
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
        globalLinksContainer: document.getElementById('globalLinksContainer'),
        btnAddGlobalLink: document.getElementById('btnAddGlobalLink'),
        userEditModal: document.getElementById('userEditModal'),
        userEditModalTitle: document.getElementById('userEditModalTitle'),
        userEditForm: document.getElementById('userEditForm'),
        userEditUid: document.getElementById('userEditUid'),
        userEditSuperAdmin: document.getElementById('userEditSuperAdmin'),
        userEditOrgs: document.getElementById('userEditOrgs'),
        logsModal: document.getElementById('logsModal'),
        logsModalTitle: document.getElementById('logsModalTitle'),
        logsModalContent: document.getElementById('logsModalContent'),
        addLinkModal: document.getElementById('addLinkModal'),
        addLinkModalTitle: document.getElementById('addLinkModalTitle'),
        addLinkForm: document.getElementById('addLinkForm'),
        addLinkContextId: document.getElementById('addLinkContextId'),
        iconPicker: document.getElementById('iconPicker'),
        projectOrgId: document.getElementById('projectOrgId'),
        projectShortName: document.getElementById('projectShortName'),
        fullProjectIdPreview: document.getElementById('fullProjectIdPreview'),
        templateName: document.getElementById('templateName'),
        fullTemplateNamePreview: document.getElementById('fullTemplateNamePreview'),
        projectsTable: document.getElementById('projectsTable'),
        sidebarToggleDesktop: document.getElementById('sidebarToggleDesktop'),
        hamburgerButton: document.getElementById('hamburgerButton'),
        mobileOverlay: document.getElementById('mobileOverlay'),
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
            { id: 'Users', icon: ICONS.USERS, adminOnly: true },
            { id: 'Settings', icon: ICONS.SETTINGS, adminOnly: true },
            { id: 'Agent', icon: ICONS.AGENT }
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
        populateIconPicker();
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
    let projectsCache = [], orgsCache = [], usersCache = [], templatesCache = [], globalLinksCache = [];

    async function loadAllData() {
        await Promise.all([loadOrgs(), loadProjects(), loadGlobalLinks()]);
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
        } catch (e) { console.error("Failed to load projects", e); }
    }
    async function loadOrgs() {
        try {
            const { items } = await callApi('/orgs');
            orgsCache = items;
            renderOrgsTable(items);
            updateOrgDropdown(items);
        } catch (e) { console.error("Failed to load orgs", e); }
    }
    async function loadUsers() {
        if (!userProfile.roles?.superAdmin) return;
        try { usersCache = await callApi('/users'); renderUsersTable(usersCache); } catch (e) { console.error("Failed to load users", e); }
    }
    async function loadGlobalLinks() {
        try {
            const { links } = await callApi('/global-links');
            globalLinksCache = links;
            renderGlobalLinks(globalLinksCache);
        } catch (e) { console.error("Failed to load global links", e); }
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

    function renderGlobalLinks(links) {
        DOM.globalLinksContainer.innerHTML = (links || []).map(link => `
            <div class="custom-link-wrapper">
                <a href="${link.url}" target="_blank" class="icon-button" title="${link.name}" style="color: var(--${link.color}-color, var(--text-secondary));">
                    ${ICONS[link.icon.toUpperCase()] || ICONS.LINK}
                </a>
                <button class="delete-link-btn" data-action="delete-global-link" data-link-id="${link.id}">&times;</button>
            </div>
        `).join('');
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
        // Lazy-load cost data for ready projects
        loadProjectCosts(projects.filter(p => p.state === 'ready'));
    }

    async function loadProjectCosts(projects) {
        for (const p of projects) {
            try {
                const data = await callApi(`/projects/${p.id}/billing`);
                const badge = document.getElementById(`cost-${p.id}`);
                if (!badge) continue;
                if (data.costThisMonth !== null && data.costThisMonth !== undefined) {
                    const cost = data.costThisMonth;
                    const symbol = data.currency === 'ILS' ? '₪' : '$';
                    badge.textContent = `${symbol}${cost.toFixed(2)}`;
                    badge.classList.add(cost > 50 ? 'cost-high' : cost > 10 ? 'cost-medium' : 'cost-low');
                    badge.title = `This month: ${symbol}${cost.toFixed(2)}` +
                        (data.costLastMonth != null ? ` | Last month: ${symbol}${data.costLastMonth.toFixed(2)}` : '');
                } else {
                    badge.textContent = '—';
                    badge.title = data.billingExportAvailable === false
                        ? 'Billing export not configured' : 'No cost data';
                }
            } catch (e) {
                // Silently skip—cost badge stays as "—"
            }
        }
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

        const externalLinksHtml = (p.externalLinks || []).map(link => `
            <div class="custom-link-wrapper">
                <a href="${link.url}" target="_blank" class="icon-button" title="${link.name}" style="color: var(--${link.color}-color, var(--text-secondary));">
                    ${ICONS[link.icon.toUpperCase()] || ICONS.LINK}
                </a>
                <button class="delete-link-btn" data-action="delete-link" data-project-id="${p.id}" data-link-id="${link.id}">&times;</button>
            </div>
        `).join('');

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
                    ${p.gcpProjectId ? `<a href="https://console.firebase.google.com/project/${p.gcpProjectId}" target="_blank" class="icon-button" title="Firebase Console">${ICONS.FIREBASE}</a>` : ''}
                    ${p.githubRepoUrl ? `<a href="${p.githubRepoUrl}" target="_blank" class="icon-button" title="GitHub Repo">${ICONS.GITHUB}</a>` : ''}
                    ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/run?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="Cloud Run Services">${ICONS.CLOUDRUN}</a>` : ''}
                    ${p.gcpProjectId ? `<a href="https://console.cloud.google.com/billing/linkedaccount?project=${p.gcpProjectId}" target="_blank" class="icon-button" title="GCP Billing">${ICONS.BILLING}</a>` : ''}
                    ${isReady ? `<a href="https://${p.id}.web.app" target="_blank" class="icon-button" title="Production Site">${ICONS.EXTERNAL_LINK}</a>` : ''}
                    ${isReady ? `<a href="https://${p.id}-qa.web.app" target="_blank" class="icon-button" title="QA Site" style="color: var(--warning-color);">${ICONS.EXTERNAL_LINK}</a>` : ''}
                    ${externalLinksHtml}
                </div>
                <span class="cost-badge" id="cost-${p.id}" title="Monthly GCP cost">—</span>
                </td>
                <td data-label="Created">${createdDateTime}</td>
                <td data-label="Actions" class="actions-cell"><div class="actions-cell-content">
                    <button class="icon-button" data-action="add-link" data-id="${p.id}" title="Add External Link">${ICONS.PLUS}</button>
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
                <td data-label="Name">${org.name}</td> <td data-label="ID">${org.id}</td>
                <td data-label="Created">${new Date(org.createdAt).toLocaleDateString()}</td>
                <td data-label="Actions" class="actions-cell"><div class="actions-cell-content">
                   ${userProfile.roles?.superAdmin ? `<button class="icon-button delete" data-type="org" data-id="${org.id}" data-name="${org.name}" title="Delete Organization">${ICONS.DELETE}</button>` : ''}
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
    DOM.btnAddGlobalLink.addEventListener('click', () => openAddLinkModal('global'));

    document.getElementById('formCreateOrg').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.orgName.value.trim();
        if (!name) return;
        try {
            await callApi('/orgs', { method: 'POST', body: JSON.stringify({ name }) });
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

        const { action, id, uid, type, name, description, projectId, linkId } = button.dataset;

        if (action === 'provision') {
            try {
                await callApi(`/projects/${id}/provision`, { method: 'POST' });
                startProjectPolling(id);
            } catch (error) {
                alert(`Failed to start provisioning for ${id}: ${error.message}`);
            }
            return;
        }

        if (action === 'add-link') {
            openAddLinkModal(id);
        } else if (action === 'delete-link') {
            if (confirm('Are you sure you want to delete this link?')) {
                try {
                    await callApi(`/projects/${projectId}/links/${linkId}`, { method: 'DELETE' });
                    await pollProjectStatus(projectId);
                } catch (error) { alert(`Failed to delete link: ${error.message}`); }
            }
        } else if (action === 'delete-global-link') {
            if (confirm('Are you sure you want to delete this global link?')) {
                try {
                    await callApi(`/global-links/${linkId}`, { method: 'DELETE' });
                    await loadGlobalLinks();
                } catch (error) { alert(`Failed to delete global link: ${error.message}`); }
            }
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

    function populateIconPicker() {
        const selectableIcons = ['LINK', 'DOCS', 'GITHUB', 'CHART', 'BILLING'];
        DOM.iconPicker.innerHTML = selectableIcons.map((iconKey, index) => `
            <input type="radio" id="icon-${iconKey}" name="linkIcon" value="${iconKey}" ${index === 0 ? 'checked' : ''}>
            <label for="icon-${iconKey}" class="icon-swatch" title="${iconKey}">${ICONS[iconKey]}</label>
        `).join('');
    }

    const openUserEditModal = (user) => {
        DOM.userEditModalTitle.textContent = `Edit: ${user.email}`;
        DOM.userEditUid.value = user.uid;
        DOM.userEditSuperAdmin.checked = user.roles?.superAdmin === true;
        DOM.userEditOrgs.innerHTML = orgsCache.map(org => `<div class="checkbox-item"><input type="checkbox" id="org-${org.id}" value="${org.id}" ${user.roles?.orgAdmin?.includes(org.id) ? 'checked' : ''}><label for="org-${org.id}">${org.name}</label></div>`).join('');
        openModal('userEditModal');
    };

    const openAddLinkModal = (contextId) => {
        DOM.addLinkForm.reset();
        document.getElementById('icon-LINK').checked = true;
        document.getElementById('color-default').checked = true;
        DOM.addLinkContextId.value = contextId;
        DOM.addLinkModalTitle.textContent = contextId === 'global' ? 'Add Global Link' : `Add Link to Project`;
        openModal('addLinkModal');
    };

    DOM.userEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = DOM.userEditUid.value;
        const roles = { superAdmin: DOM.userEditSuperAdmin.checked, orgAdmin: Array.from(DOM.userEditOrgs.querySelectorAll('input:checked')).map(input => input.value) };
        try { await callApi(`/users/${uid}`, { method: 'PUT', body: JSON.stringify({ roles }) }); closeModal('userEditModal'); await loadUsers(); } catch (error) { alert(`Error: ${error.message}`); }
    });

    DOM.addLinkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const contextId = DOM.addLinkContextId.value;
        const body = {
            name: document.getElementById('linkName').value,
            url: document.getElementById('linkUrl').value,
            color: document.querySelector('input[name="linkColor"]:checked').value,
            icon: document.querySelector('input[name="linkIcon"]:checked').value,
        };

        try {
            if (contextId === 'global') {
                await callApi('/global-links', { method: 'POST', body: JSON.stringify(body) });
                await loadGlobalLinks();
            } else {
                await callApi(`/projects/${contextId}/links`, { method: 'POST', body: JSON.stringify(body) });
                await pollProjectStatus(contextId);
            }
            closeModal('addLinkModal');
        } catch (error) {
            alert(`Error adding link: ${error.message}`);
        }
    });

    async function showLogsForProject(projectId) {
        // ... (remains the same)
        DOM.logsModalTitle.textContent = `Logs for: ${projectId}`;
        DOM.logsModalContent.innerHTML = '<div class="spinner" style="display:block;"></div>';
        openModal('logsModal');
        try {
            const { logs } = await callApi(`/projects/${projectId}/logs`);
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
    // ... (isProjectInProcess, getProgressForState, start/stop polling remain the same)
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

    // --- Settings / Secrets Management (Additive — no existing code changed) ---
    const CATEGORY_LABELS = {
        github: { title: 'GitHub App', description: 'Required for provisioning new projects via GitHub.', icon: ICONS.GITHUB },
        ai: { title: 'AI API Keys', description: 'Configure OpenAI and Gemini keys for AI features.', icon: '🤖' },
        whatsapp: { title: 'WhatsApp', description: 'Configure WhatsApp Business API integration.', icon: '💬' },
    };

    async function loadSecrets() {
        try {
            const data = await callApi('/settings/secrets');
            if (data.ok) renderSecretsUI(data.grouped, data.secrets);
        } catch (e) {
            console.error('Failed to load secrets', e);
            document.getElementById('secretsContainer').innerHTML =
                '<div class="card"><p style="color:var(--error-color);">Failed to load secrets status. Make sure the Settings API is deployed.</p></div>';
        }
    }

    function renderSecretsUI(grouped, allSecrets) {
        const container = document.getElementById('secretsContainer');
        const banner = document.getElementById('secretsStatusBanner');
        const statusIcon = document.getElementById('secretsStatusIcon');
        const statusText = document.getElementById('secretsStatusText');

        const total = allSecrets.length;
        const configured = allSecrets.filter(s => s.configured).length;

        banner.style.display = '';
        if (configured === total) {
            statusIcon.textContent = '✅';
            statusText.textContent = `All ${total} secrets are configured.`;
            banner.style.borderLeft = '4px solid var(--success-color)';
        } else {
            statusIcon.textContent = '⚠️';
            statusText.textContent = `${configured}/${total} secrets configured. Set the remaining to enable full functionality.`;
            banner.style.borderLeft = '4px solid var(--warning-color, #f59e0b)';
        }

        let html = '';
        for (const [category, secrets] of Object.entries(grouped)) {
            const meta = CATEGORY_LABELS[category] || { title: category, description: '', icon: '🔑' };
            const catConfigured = secrets.filter(s => s.configured).length;
            const catTotal = secrets.length;
            const allDone = catConfigured === catTotal;

            html += `<div class="card" style="margin-bottom: 1rem;">`;
            html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">`;
            html += `<div style="display:flex;align-items:center;gap:10px;">`;
            html += `<span style="font-size:1.5rem;">${typeof meta.icon === 'string' && meta.icon.startsWith('<') ? meta.icon : meta.icon}</span>`;
            html += `<div><h3 style="margin:0;font-size:1.1rem;">${meta.title}</h3>`;
            html += `<p style="margin:0;font-size:0.8rem;color:var(--text-secondary);">${meta.description}</p></div>`;
            html += `</div>`;
            html += `<span style="font-size:0.85rem;font-weight:600;color:${allDone ? 'var(--success-color)' : 'var(--warning-color, #f59e0b)'}">${catConfigured}/${catTotal}</span>`;
            html += `</div>`;

            secrets.forEach(secret => {
                const statusBadge = secret.configured
                    ? '<span style="color:var(--success-color);font-weight:600;font-size:0.85rem;">✅ Configured</span>'
                    : '<span style="color:var(--warning-color, #f59e0b);font-weight:600;font-size:0.85rem;">⚠️ Not set</span>';

                const inputType = secret.sensitive ? 'password' : 'text';
                const isTextArea = secret.name === 'GITHUB_PRIVATE_KEY';

                html += `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border-color);" id="secret-row-${secret.name}">`;
                html += `<div style="flex:1;"><label style="font-weight:500;font-size:0.9rem;">${secret.label}</label>`;
                html += `<div style="font-size:0.75rem;color:var(--text-secondary);">${secret.name}</div></div>`;
                html += `<div style="display:flex;align-items:center;gap:8px;">${statusBadge}`;

                if (isTextArea) {
                    html += `<textarea data-secret="${secret.name}" rows="3" cols="30" placeholder="Paste PEM content..." style="font-size:0.8rem;padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-family:monospace;"></textarea>`;
                } else {
                    html += `<input type="${inputType}" data-secret="${secret.name}" placeholder="Enter value..." style="width:200px;font-size:0.85rem;padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);">`;
                }

                html += `<button class="btn btn-primary btn-sm" onclick="window.__saveSecret('${secret.name}')" style="white-space:nowrap;">Save</button>`;
                html += `</div></div>`;
            });

            html += `</div>`;
        }
        container.innerHTML = html;
    }

    // Global save function (accessible from onclick)
    window.__saveSecret = async function (secretName) {
        const input = document.querySelector(`[data-secret="${secretName}"]`);
        if (!input) return;
        const value = input.value.trim();
        if (!value) { alert('Please enter a value.'); return; }

        const btn = input.parentElement.querySelector('.btn');
        const origText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            const result = await callApi(`/settings/secrets/${secretName}`, {
                method: 'PUT',
                body: JSON.stringify({ value }),
            });
            if (result.ok) {
                input.value = '';
                btn.textContent = '✓ Saved';
                setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
                loadSecrets(); // Refresh status
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (e) {
            alert(`Failed to save secret: ${e.message}`);
            btn.textContent = origText;
            btn.disabled = false;
        }
    };

    // --- GitHub App Setup Wizard ---
    let ghSetupInstallUrl = null;

    async function loadGithubSetupStatus() {
        const loading = document.getElementById('ghSetupLoading');
        const notConnected = document.getElementById('ghSetupNotConnected');
        const created = document.getElementById('ghSetupCreated');
        const connected = document.getElementById('ghSetupConnected');

        // Show loading
        loading.classList.remove('hidden');
        notConnected.classList.add('hidden');
        created.classList.add('hidden');
        connected.classList.add('hidden');

        try {
            const data = await callApi('/github/setup/status');
            loading.classList.add('hidden');

            if (data.status.configured) {
                // Fully connected
                connected.classList.remove('hidden');
                document.getElementById('ghSetupConnectedInfo').textContent =
                    `App ID: ${data.status.appId || 'unknown'} · Org: ${data.status.githubOwner || 'N/A'}`;
            } else if (data.status.appCreated) {
                // App created but not installed
                created.classList.remove('hidden');
                document.getElementById('ghSetupAppId').textContent = `(ID: ${data.status.appId || '...'})`;
            } else {
                // Not connected at all
                notConnected.classList.remove('hidden');
            }
        } catch (e) {
            loading.classList.add('hidden');
            notConnected.classList.remove('hidden');
            console.error('Failed to check GitHub setup status', e);
        }
    }

    // "Connect GitHub App" button — initiates manifest flow
    document.getElementById('btnConnectGithub').addEventListener('click', async () => {
        const btn = document.getElementById('btnConnectGithub');
        btn.disabled = true;
        btn.textContent = 'Preparing...';

        try {
            const data = await callApi('/github/setup/start');
            if (!data.ok) throw new Error(data.error);

            // Create a hidden form and POST the manifest to GitHub
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = data.githubUrl;
            form.style.display = 'none';

            const manifestInput = document.createElement('input');
            manifestInput.type = 'hidden';
            manifestInput.name = 'manifest';
            manifestInput.value = data.manifest;
            form.appendChild(manifestInput);

            document.body.appendChild(form);
            form.submit();
        } catch (e) {
            alert(`Failed to start GitHub setup: ${e.message}`);
            btn.disabled = false;
            btn.textContent = 'Connect GitHub App';
        }
    });

    // "Install on Organization" button
    document.getElementById('btnInstallApp').addEventListener('click', () => {
        if (ghSetupInstallUrl) {
            window.open(ghSetupInstallUrl, '_blank');
        } else {
            // Fallback: open the app settings on GitHub
            const owner = prompt('Enter your GitHub app slug (from the app URL):');
            if (owner) window.open(`https://github.com/apps/${owner}/installations/new`, '_blank');
        }
    });

    // "Save Installation ID" button (manual fallback)
    document.getElementById('btnSaveInstallationId').addEventListener('click', async () => {
        const input = document.getElementById('ghInstallationIdInput');
        const installationId = input.value.trim();
        if (!installationId) { alert('Please enter an installation ID.'); return; }

        try {
            const result = await callApi('/github/setup/save-installation', {
                method: 'POST',
                body: JSON.stringify({ installationId }),
            });
            if (result.ok) {
                input.value = '';
                alert('Installation ID saved!');
                loadGithubSetupStatus();
            }
        } catch (e) {
            alert(`Failed to save: ${e.message}`);
        }
    });

    // Handle redirect from GitHub callback (URL query params)
    function handleGithubSetupRedirect() {
        const params = new URLSearchParams(window.location.search);
        const setupResult = params.get('github_setup');
        if (!setupResult) return;

        if (setupResult === 'success') {
            const appName = params.get('app_name') || 'GitHub App';
            ghSetupInstallUrl = params.get('install_url');
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
            // Switch to Settings tab and show success
            switchTab('Settings');
            setTimeout(() => {
                loadGithubSetupStatus();
            }, 500);
        } else if (setupResult === 'error') {
            const message = params.get('message') || 'Unknown error';
            window.history.replaceState({}, '', window.location.pathname);
            switchTab('Settings');
            alert(`GitHub App setup failed: ${message}`);
        }
    }

    // Hook up refresh button (only if it exists)
    const btnRefreshSecrets = document.getElementById('btnRefreshSecrets');
    if (btnRefreshSecrets) {
        btnRefreshSecrets.addEventListener('click', () => {
            loadSecrets();
            loadGithubSetupStatus();
        });
    }

    // Override switchTab to also trigger secrets + setup loading
    const origSwitchTab = switchTab;
    switchTab = function (tabId) {
        origSwitchTab(tabId);
        if (tabId === 'Settings') {
            loadSecrets();
            loadGithubSetupStatus();
        }
    };

    // Check for GitHub setup redirect on page load
    handleGithubSetupRedirect();

    // ─── AI Agent Chat ────────────────────────────────────
    let agentSessionId = crypto.randomUUID();
    let agentBusy = false;

    const agentInput = document.getElementById('agentInput');
    const btnSend = document.getElementById('btnSendAgent');
    const agentMessages = document.getElementById('agentMessages');
    const btnNewChat = document.getElementById('btnNewChat');

    // Auto-grow textarea
    if (agentInput) {
        agentInput.addEventListener('input', () => {
            agentInput.style.height = 'auto';
            agentInput.style.height = Math.min(agentInput.scrollHeight, 120) + 'px';
            btnSend.disabled = !agentInput.value.trim() || agentBusy;
        });
        agentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!btnSend.disabled) sendAgentMessage();
            }
        });
    }
    if (btnSend) btnSend.addEventListener('click', sendAgentMessage);

    // Suggestion buttons
    document.querySelectorAll('.agent-suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
            if (agentBusy) return;
            agentInput.value = btn.dataset.prompt;
            sendAgentMessage();
        });
    });

    // New chat
    if (btnNewChat) {
        btnNewChat.addEventListener('click', () => {
            agentSessionId = crypto.randomUUID();
            agentMessages.innerHTML = `
                <div class="agent-welcome">
                    <div class="agent-welcome-icon">🤖</div>
                    <h3>WIZBI AI Agent</h3>
                    <p>Ask me anything about your infrastructure.</p>
                    <div class="agent-suggestions">
                        <button class="agent-suggestion" data-prompt="Show me all organizations and their projects">📊 Show all orgs & projects</button>
                        <button class="agent-suggestion" data-prompt="What's the health status of the system?">💚 System health check</button>
                        <button class="agent-suggestion" data-prompt="List all available templates">📦 Available templates</button>
                        <button class="agent-suggestion" data-prompt="Show me all users and their roles">👥 Users & roles</button>
                    </div>
                </div>`;
            document.querySelectorAll('.agent-suggestion').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (agentBusy) return;
                    agentInput.value = btn.dataset.prompt;
                    sendAgentMessage();
                });
            });
        });
    }

    async function sendAgentMessage() {
        const msg = agentInput.value.trim();
        if (!msg || agentBusy) return;

        agentBusy = true;
        btnSend.disabled = true;
        agentInput.value = '';
        agentInput.style.height = 'auto';

        // Remove welcome screen
        const welcome = agentMessages.querySelector('.agent-welcome');
        if (welcome) welcome.remove();

        // Add user message
        appendMessage('user', msg);

        // Add typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'agent-typing';
        typingEl.innerHTML = '<div class="agent-typing-dot"></div><div class="agent-typing-dot"></div><div class="agent-typing-dot"></div>';
        agentMessages.appendChild(typingEl);
        scrollToBottom();

        try {
            const response = await fetch('/api/agent/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Firebase-ID-Token': idToken,
                },
                body: JSON.stringify({ message: msg, sessionId: agentSessionId }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            // Read SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let assistantTextParts = [];
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;

                    let chunk;
                    try { chunk = JSON.parse(jsonStr); } catch { continue; }

                    if (chunk.type === 'text') {
                        // Remove typing indicator on first text
                        typingEl.remove();
                        assistantTextParts.push(chunk.content);
                        appendMessage('assistant', assistantTextParts.join(''), true);
                    } else if (chunk.type === 'tool_call') {
                        appendToolCard(chunk.toolName, chunk.content, 'running');
                    } else if (chunk.type === 'tool_result') {
                        updateToolCard(chunk.toolName, chunk.content, 'done');
                    } else if (chunk.type === 'error') {
                        typingEl.remove();
                        appendMessage('assistant', `⚠️ Error: ${chunk.content}`);
                    }
                    scrollToBottom();
                }
            }
        } catch (e) {
            typingEl.remove();
            appendMessage('assistant', `⚠️ Failed to reach agent: ${e.message}`);
        }

        agentBusy = false;
        btnSend.disabled = !agentInput.value.trim();
    }

    let lastAssistantEl = null;

    function appendMessage(role, content, isUpdate = false) {
        if (role === 'assistant' && isUpdate && lastAssistantEl) {
            lastAssistantEl.querySelector('.agent-msg-body').innerHTML = renderMarkdown(content);
            return;
        }

        const el = document.createElement('div');
        el.className = `agent-msg ${role}`;
        el.innerHTML = `
            <div class="agent-msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
            <div class="agent-msg-body">${role === 'user' ? escapeHtml(content) : renderMarkdown(content)}</div>
        `;
        agentMessages.appendChild(el);

        if (role === 'assistant') lastAssistantEl = el;
        else lastAssistantEl = null;
    }

    function appendToolCard(toolName, args, status) {
        lastAssistantEl = null; // Reset so next text creates new message
        const card = document.createElement('div');
        card.className = 'agent-tool-card';
        card.id = `tool-card-${toolName}-${Date.now()}`;
        card.dataset.toolName = toolName;
        card.innerHTML = `
            <div class="agent-tool-header" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="agent-tool-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></div>
                <span class="agent-tool-name">${escapeHtml(toolName)}</span>
                <span class="agent-tool-status ${status}">${status === 'running' ? 'Running…' : 'Done'}</span>
                <svg class="agent-tool-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <div class="agent-tool-body">
                <strong>Input:</strong>
                <pre>${escapeHtml(formatJson(args))}</pre>
            </div>
        `;
        agentMessages.appendChild(card);
    }

    function updateToolCard(toolName, result, status) {
        // Find last card with this tool name
        const cards = agentMessages.querySelectorAll(`[data-tool-name="${toolName}"]`);
        const card = cards[cards.length - 1];
        if (!card) return;

        const statusEl = card.querySelector('.agent-tool-status');
        statusEl.className = `agent-tool-status ${status}`;
        statusEl.textContent = status === 'done' ? 'Done' : status === 'error' ? 'Error' : 'Running…';

        const body = card.querySelector('.agent-tool-body');
        body.innerHTML += `<strong style="margin-top:8px;display:block;">Result:</strong><pre>${escapeHtml(formatJson(result))}</pre>`;
    }

    function scrollToBottom() {
        agentMessages.scrollTop = agentMessages.scrollHeight;
    }

    function escapeHtml(str) {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatJson(str) {
        try {
            const obj = typeof str === 'string' ? JSON.parse(str) : str;
            return JSON.stringify(obj, null, 2);
        } catch {
            return str;
        }
    }

    function renderMarkdown(text) {
        if (!text) return '';
        return text
            // Code blocks
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Bold
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // Headers
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            // Unordered lists
            .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
            // Ordered lists
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // Wrap consecutive li elements
            .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            // Wrap in paragraph
            .replace(/^(?!<[hupol])(.+)/gm, '<p>$1</p>')
            // Clean up empty paragraphs
            .replace(/<p><\/p>/g, '');
    }
});

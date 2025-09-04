document.addEventListener('DOMContentLoaded', () => {
  const firebaseAuth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();
  let idToken = null;

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
      const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Firebase-ID-Token': idToken, ...(options.headers || {}) } });
      const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));
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
      } catch(e) {
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
    }
  });
  
  DOM.btnLogin.addEventListener('click', () => firebaseAuth.signInWithPopup(googleProvider));
  DOM.btnLogoutAdmin.addEventListener('click', () => firebaseAuth.signOut());
  DOM.btnLogoutUnauthorized.addEventListener('click', () => firebaseAuth.signOut());

  const switchTab = (activeTab) => {
    const isProjects = activeTab === 'projects';
    DOM.btnTabProjects.classList.toggle('active', isProjects);
    DOM.tabContentProjects.classList.toggle('active', isProjects);
    DOM.btnTabOrgs.classList.toggle('active', !isProjects);
    DOM.tabContentOrgs.classList.toggle('active', !isProjects);
  };
  DOM.btnTabProjects.addEventListener('click', () => switchTab('projects'));
  DOM.btnTabOrgs.addEventListener('click', () => switchTab('orgs'));

  const renderTable = (tbody, data, columns, emptyMessage) => {
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}">${emptyMessage}</td></tr>`;
      return;
    }
    data.forEach(item => {
      const row = tbody.insertRow();
      columns.forEach(col => {
        const cell = row.insertCell();
        let value = item[col.key] || '';
        if (col.formatter) value = col.formatter(value);
        cell.textContent = value;
      });
    });
  };

  const loadOrgs = async () => {
    DOM.orgsSpinner.style.display = 'block';
    try {
      const { items } = await callApi('/orgs');
      renderTable(DOM.orgsTableBody, items, [{ key: 'id' }, { key: 'name' }, { key: 'phone' }, { key: 'createdAt', formatter: (v) => new Date(v).toLocaleString() }], 'No organizations found.');
      DOM.projectOrgIdSelect.innerHTML = '<option value="" disabled selected>Select an Organization</option>';
      items.forEach(org => {
          const option = document.createElement('option');
          option.value = org.id;
          option.textContent = org.name;
          DOM.projectOrgIdSelect.appendChild(option);
      });
    } finally {
      DOM.orgsSpinner.style.display = 'none';
    }
  };

  const loadProjects = async () => {
    DOM.projectsSpinner.style.display = 'block';
    try {
      const items = await callApi('/projects');
      renderTable(DOM.projectsTableBody, items, [{ key: 'id' }, { key: 'projectId' }, { key: 'displayName' }, { key: 'orgId' }, { key: 'state' }, { key: 'createdAt', formatter: (v) => new Date(v).toLocaleString() }], 'No projects found.');
    } finally {
      DOM.projectsSpinner.style.display = 'none';
    }
  };

  DOM.formCreateOrg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.elements.orgName.value;
    const phone = e.target.elements.orgPhone.value;
    log('Creating new organization...');
    try {
      await callApi('/orgs', { method: 'POST', body: JSON.stringify({ name, phone }) });
      log('Organization created successfully!');
      DOM.formCreateOrg.reset();
      await loadOrgs();
    } catch (error) { /* error is already logged by callApi */ }
  });

  DOM.formProvisionProject.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgId = e.target.elements.projectOrgId.value;
    const projectId = e.target.elements.projectId.value;
    const displayName = e.target.elements.projectDisplayName.value;
    if (!confirm(`Provision new project '${displayName}' for the selected organization?`)) return;
    log(`Starting provisioning for '${projectId}'...`);
    try {
      await callApi('/projects', { method: 'POST', body: JSON.stringify({ orgId, projectId, displayName }) });
      log('Project provisioning started. The table will refresh shortly.');
      DOM.formProvisionProject.reset();
      setTimeout(loadProjects, 5000);
    } catch (error) { /* error is already logged by callApi */ }
  });
});

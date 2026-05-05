// ==========================================
// FRONTEND LOGIC (STANDALONE PWA)
// ==========================================

const API_URL = "https://script.google.com/macros/s/AKfycbzmraykxQXzNeJr2UFSuLaOL-zBBDr3ijnHWR8ScBUADpcILSgKU5bBW9Ci8yZLMT1WmQ/exec"; // REPLACE THIS WITH YOUR APPS SCRIPT WEB APP URL

// API Wrapper replacing google.script.run
function apiCall(action, payload = {}) {
  return new Promise((resolve, reject) => {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // Avoids CORS preflight issues in GAS
      body: JSON.stringify({ action, ...payload })
    })
      .then(async res => {
        const text = await res.text();
        if (text.trim().startsWith('<')) {
          console.error("Received HTML instead of JSON. This usually indicates a Google Apps Script deployment permissions issue or a Google Login redirect.", text);
          throw new Error("Server Deployment Error: Ensure the Apps Script Web App is deployed as 'Execute as: Me' and 'Who has access: Anyone'.");
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error("Invalid JSON from server.");
        }
      })
      .then(data => resolve(data))
      .catch(err => reject(err));
  });
}

let currentUser = null;
let currentStaffData = [];

// ------------------------------------------
// UI NAVIGATION & STATE
// ------------------------------------------
function switchTab(tabId) {
  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  if (typeof event !== 'undefined' && event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  } else {
    const navBtn = document.querySelector('.nav-btn[data-tab="' + tabId + '"]');
    if (navBtn) navBtn.classList.add('active');
  }

  // Update views — toggle .active, which CSS uses to show/hide
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  const targetView = document.getElementById('view-' + tabId);
  if (targetView) targetView.classList.add('active');

  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'directory') loadStaffDirectory();
  if (tabId === 'audit') loadAuditLogs();
  if (tabId === 'users') loadUsers();
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// ------------------------------------------
// AUTHENTICATION
// ------------------------------------------
function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById('login-user').value;
  const pass = document.getElementById('login-pass').value;
  const btn = document.getElementById('btn-login');

  btn.textContent = 'Authenticating...';
  btn.disabled = true;

  apiCall('authenticateUser', { user, pass })
    .then(res => {
      btn.textContent = 'Login';
      btn.disabled = false;
      if (res.success) {
        currentUser = res.user;
        document.getElementById('user-name').textContent = currentUser.Name;
        document.getElementById('user-avatar').textContent = currentUser.Name.charAt(0);
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('active');

        if (currentUser.Role === 'Admin') {
          document.getElementById('nav-users').style.display = 'block';
        } else {
          document.getElementById('nav-users').style.display = 'none';
        }

        document.getElementById('ai-chat-btn').style.display = 'flex';

        loadDashboard();
      } else {
        document.getElementById('login-error').textContent = res.message;
      }
    })
    .catch(err => {
      btn.textContent = 'Login';
      btn.disabled = false;
      console.error("Login fetch error:", err);
      document.getElementById('login-error').textContent = err.message || "Server error. Please try again.";
    });
}

function handleLogout() {
  currentUser = null;
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('login-form').reset();

  document.getElementById('ai-chat-btn').style.display = 'none';
  if (isAIChatOpen) toggleAIChat();
}

// ------------------------------------------
// DASHBOARD
// ------------------------------------------
function loadDashboard() {
  const alertsList = document.getElementById('system-flags-list');
  alertsList.innerHTML = '<li><div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div> Loading alerts...</li>';
  const salaryTbody = document.getElementById('salary-grade-list');
  salaryTbody.innerHTML = '<tr><td colspan="2" class="text-center"><div class="spinner"></div></td></tr>';

  apiCall('getDashboardMetrics')
    .then(metrics => {
      document.getElementById('metric-total').textContent = metrics.total;
      document.getElementById('metric-active').textContent = metrics.active;
      document.getElementById('metric-senior').textContent = metrics.senior;
      document.getElementById('metric-junior').textContent = metrics.junior;
      document.getElementById('metric-nurses').textContent = metrics.nurses_midwives;
      document.getElementById('metric-maintenance').textContent = metrics.maintenance;
      document.getElementById('metric-admin').textContent = metrics.admin_exec;
      document.getElementById('metric-doctors').textContent = metrics.doctors;

      alertsList.innerHTML = '';
      if (metrics.recent_flags && metrics.recent_flags.length > 0) {
        metrics.recent_flags.forEach(flag => {
          alertsList.innerHTML += `<li>${escapeHtml(flag)}</li>`;
        });
      } else {
        alertsList.innerHTML = '<li><span class="status-indicator warning"></span> No flags to display.</li>';
      }

      salaryTbody.innerHTML = '';
      const grades = Object.keys(metrics.salary_grades).sort();
      if (grades.length === 0) {
        salaryTbody.innerHTML = '<tr><td colspan="2" class="text-center">No data available.</td></tr>';
      } else {
        grades.forEach(grade => {
          const count = metrics.salary_grades[grade];
          salaryTbody.innerHTML += `<tr><td>${grade}</td><td>${count}</td></tr>`;
        });
      }
    })
    .catch(console.error);
}

// ------------------------------------------
// STAFF DIRECTORY
// ------------------------------------------
function loadStaffDirectory(force = false) {
  if (!force && currentStaffData.length > 0) {
    renderStaffTable(currentStaffData);
    return;
  }
  const tbody = document.getElementById('staff-table-body');
  tbody.innerHTML = '<tr><td colspan="9" class="text-center"><div class="spinner"></div> Loading data...</td></tr>';

  apiCall('getAllStaffData')
    .then(data => {
      currentStaffData = data;
      renderStaffTable(data);
    })
    .catch(err => {
      console.error('getAllStaffData failed:', err);
      tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:red;">Error loading staff data.</td></tr>';
    });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderStaffTable(data) {
  const tbody = document.getElementById('staff-table-body');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No staff records found.</td></tr>';
    return;
  }

  data.forEach(staff => {
    const tr = document.createElement('tr');

    // Passport logic
    let avatarHtml = `<div class="avatar" style="width: 32px; height: 32px; font-size: 14px;">${staff.FullName ? staff.FullName.charAt(0) : '?'}</div>`;
    if (staff.PassportUrl) {
      avatarHtml = `<img src="${staff.PassportUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">`;
    }

    tr.innerHTML = `
    <td>${avatarHtml}</td>
    <td class="font-mono">${escapeHtml(staff.FolderNumber) || 'N/A'}</td>
    <td class="font-mono">${escapeHtml(staff.IPPISNo) || '-'}</td>
    <td class="font-medium">${escapeHtml(staff.FullName) || 'Unknown'}</td>
    <td>${escapeHtml(staff.Cadre) || 'N/A'}</td>
    <td><span class="badge ${escapeHtml(staff.StaffLevel) === 'Senior' ? 'badge-senior' : 'badge-junior'}">${escapeHtml(staff.StaffLevel) || 'N/A'}</span></td>
    <td>${escapeHtml(staff.Department) || 'N/A'}</td>
    <td><span class="badge ${staff.Status === 'Inactive' ? 'badge-junior' : 'badge-senior'}" style="background-color: ${staff.Status === 'Inactive' ? '#fee2e2' : ''}; color: ${staff.Status === 'Inactive' ? '#991b1b' : ''}">${escapeHtml(staff.Status) || 'Active'}</span></td>
    <td>
      <button class="btn btn-text" style="padding: 4px 8px" onclick="editStaff('${escapeHtml(staff.ID)}')">Edit</button>
      <button class="btn btn-text" style="padding: 4px 8px; color: ${staff.Status === 'Inactive' ? 'green' : 'red'};" onclick="toggleStaffStatus('${escapeHtml(staff.ID)}')">${staff.Status === 'Inactive' ? 'Activate' : 'Deactivate'}</button>
    </td>
  `;
    tbody.appendChild(tr);
  });
}

function filterStaff() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const level = document.getElementById('filter-level').value;

  const filtered = currentStaffData.filter(s => {
    const matchQuery = (s.FullName && s.FullName.toLowerCase().includes(query)) ||
      (s.FolderNumber && s.FolderNumber.toLowerCase().includes(query)) ||
      (s.IPPISNo && s.IPPISNo.toLowerCase().includes(query));
    const matchLevel = level ? s.StaffLevel === level : true;
    return matchQuery && matchLevel;
  });

  renderStaffTable(filtered);
}

// ------------------------------------------
// AUDIT LOGS
// ------------------------------------------
let currentAuditPage = 1;
const auditPageSize = 50;

function loadAuditLogs(page = 1) {
  currentAuditPage = page;
  const tbody = document.getElementById('audit-table-body');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="spinner"></div> Loading logs...</td></tr>';

  apiCall('getPaginatedAuditLogs', { page, pageSize: auditPageSize })
    .then(res => {
      tbody.innerHTML = '';
      if (res.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No logs found.</td></tr>';
      } else {
        res.data.forEach(log => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${new Date(log.Timestamp).toLocaleString()}</td>
            <td>${escapeHtml(log.User)}</td>
            <td><span class="badge badge-senior">${escapeHtml(log.Action)}</span></td>
            <td class="font-mono">${escapeHtml(log.TargetID)}</td>
            <td>${escapeHtml(log.Details)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
      document.getElementById('audit-page-info').textContent = `Page ${res.page} of ${res.totalPages || 1}`;
      document.getElementById('btn-audit-prev').disabled = res.page <= 1;
      document.getElementById('btn-audit-next').disabled = res.page >= res.totalPages;
    })
    .catch(err => {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:red;">Error loading logs.</td></tr>';
    });
}

function changeAuditPage(delta) {
  loadAuditLogs(currentAuditPage + delta);
}

function toggleStaffStatus(id) {
  if (!confirm('Are you sure you want to change the status of this staff member?')) return;
  showToast('Updating status...', 'success');

  apiCall('toggleStaffStatus', { currentUser, id })
    .then(res => {
      showToast(res.message, res.success ? 'success' : 'error');
      if (res.success) loadStaffDirectory(true);
    })
    .catch(err => showToast('Server error.', 'error'));
}

// ------------------------------------------
// MODAL (ADD / EDIT) & PASSPORTS
// ------------------------------------------
function openStaffModal() {
  document.getElementById('staff-form').reset();
  document.getElementById('f-id').value = '';
  document.getElementById('modal-title').textContent = 'Add New Staff';
  document.getElementById('modal-feedback').textContent = '';

  // Reset Passport UI
  document.getElementById('f-passport-preview').style.display = 'none';
  document.getElementById('f-passport-initials').style.display = 'flex';
  document.getElementById('f-passport-initials').textContent = '?';
  document.getElementById('f-passport-url').value = '';
  document.getElementById('btn-ai-summarize').style.display = 'none';

  document.getElementById('staff-modal').classList.remove('hidden');
}

function closeStaffModal() {
  document.getElementById('staff-modal').classList.add('hidden');
}

function editStaff(id) {
  const staff = currentStaffData.find(s => s.ID === id);
  if (!staff) return;

  document.getElementById('modal-title').textContent = 'Edit Staff Record';
  document.getElementById('btn-ai-summarize').style.display = 'inline-block';
  document.getElementById('f-id').value = staff.ID;
  document.getElementById('f-name').value = staff.FullName || '';
  document.getElementById('f-folder').value = staff.FolderNumber || '';
  document.getElementById('f-ippis').value = staff.IPPISNo || '';
  document.getElementById('f-cadre').value = staff.Cadre || '';
  document.getElementById('f-phone').value = staff.Phone || '';
  document.getElementById('f-staff-level').value = staff.StaffLevel || 'Senior';
  document.getElementById('f-dept').value = staff.Department || '';
  document.getElementById('f-emp-type').value = staff.EmploymentType || 'Permanent';
  document.getElementById('f-status').value = staff.Status || 'Active';

  document.getElementById('f-appt-cat').value = staff.AppointmentCategory || '';
  document.getElementById('f-salary-scale').value = staff.SalaryScale || '';

  // Format dates for input[type=date]
  const formatD = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
  document.getElementById('f-first-appt').value = formatD(staff.DateOfFirstAppointment);
  document.getElementById('f-absorption').value = formatD(staff.DateOfAbsorption);
  document.getElementById('f-confirmation').value = formatD(staff.DateOfConfirmation);
  document.getElementById('f-last-promo').value = formatD(staff.DateOfLastPromotion);

  document.getElementById('f-gl').value = staff.CurrentGradeLevel || '';
  document.getElementById('f-step').value = staff.CurrentStep || '';

  // Credentials
  document.getElementById('f-edu').value = staff.EducationalHistory || '';
  document.getElementById('f-prof-qual').value = staff.ProfessionalQualifications || '';
  document.getElementById('f-licenses').value = staff.Licenses || '';
  document.getElementById('f-nysc').value = staff.NYSCStatus || '';
  document.getElementById('f-prev-emp').value = staff.PreviousEmployment || '';
  document.getElementById('f-submitted-docs').value = staff.SubmittedDocuments || '';
  document.getElementById('f-missing-docs').value = staff.MissingDocuments || '';

  // Passport UI
  document.getElementById('f-passport-url').value = staff.PassportUrl || '';
  if (staff.PassportUrl) {
    document.getElementById('f-passport-preview').src = staff.PassportUrl;
    document.getElementById('f-passport-preview').style.display = 'block';
    document.getElementById('f-passport-initials').style.display = 'none';
  } else {
    document.getElementById('f-passport-preview').style.display = 'none';
    document.getElementById('f-passport-initials').style.display = 'flex';
    document.getElementById('f-passport-initials').textContent = staff.FullName ? staff.FullName.charAt(0) : '?';
  }

  document.getElementById('modal-feedback').textContent = '';
  document.getElementById('staff-modal').classList.remove('hidden');
}

// Handle local file selection for Passport
document.getElementById('f-passport-file').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;

  // Max 2MB check
  if (file.size > 2 * 1024 * 1024) {
    alert("Image size exceeds 2MB limit.");
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function (event) {
    // Show preview immediately
    document.getElementById('f-passport-preview').src = event.target.result;
    document.getElementById('f-passport-preview').style.display = 'block';
    document.getElementById('f-passport-initials').style.display = 'none';
  };
  reader.readAsDataURL(file);
});


async function submitStaffForm() {
  const data = {
    ID: document.getElementById('f-id').value,
    FullName: document.getElementById('f-name').value,
    FolderNumber: document.getElementById('f-folder').value,
    IPPISNo: document.getElementById('f-ippis').value,
    Cadre: document.getElementById('f-cadre').value,
    Phone: document.getElementById('f-phone').value,
    StaffLevel: document.getElementById('f-staff-level').value,
    Department: document.getElementById('f-dept').value,
    EmploymentType: document.getElementById('f-emp-type').value,
    Status: document.getElementById('f-status').value,
    AppointmentCategory: document.getElementById('f-appt-cat').value,
    SalaryScale: document.getElementById('f-salary-scale').value,
    DateOfFirstAppointment: document.getElementById('f-first-appt').value,
    DateOfAbsorption: document.getElementById('f-absorption').value,
    DateOfConfirmation: document.getElementById('f-confirmation').value,
    DateOfLastPromotion: document.getElementById('f-last-promo').value,
    CurrentGradeLevel: document.getElementById('f-gl').value,
    CurrentStep: document.getElementById('f-step').value,
    EducationalHistory: document.getElementById('f-edu').value,
    ProfessionalQualifications: document.getElementById('f-prof-qual').value,
    Licenses: document.getElementById('f-licenses').value,
    NYSCStatus: document.getElementById('f-nysc').value,
    PreviousEmployment: document.getElementById('f-prev-emp').value,
    SubmittedDocuments: document.getElementById('f-submitted-docs').value,
    MissingDocuments: document.getElementById('f-missing-docs').value,
    PassportUrl: document.getElementById('f-passport-url').value,
  };

  if (!data.FullName || !data.FolderNumber) {
    document.getElementById('modal-feedback').className = 'feedback-msg error';
    document.getElementById('modal-feedback').textContent = 'Name and Folder Number are required.';
    return;
  }

  document.getElementById('modal-feedback').textContent = 'Saving...';
  document.getElementById('modal-feedback').className = 'feedback-msg';

  try {
    // 1. Save Staff Record first
    const res = await apiCall('saveStaffRecord', { currentUser, data });
    if (!res.success) throw new Error(res.message);

    // 2. Handle Passport Upload if there's a new file selected
    const fileInput = document.getElementById('f-passport-file');
    if (fileInput.files.length > 0) {
      document.getElementById('modal-feedback').textContent = 'Uploading passport...';
      const file = fileInput.files[0];
      const base64Data = await getBase64(file);
      const pureBase64 = base64Data.split(',')[1];

      const staffIdToUse = data.ID || currentStaffData.find(s => s.FolderNumber === data.FolderNumber)?.ID || 'temp'; // In case it was new and ID generated in backend. Actually better: fetch directory to get ID if it was new.

      // We will reload directory anyway, but backend needs the ID.
      // Wait, saveStaffRecord doesn't return the new ID currently.
      // Assuming it's an edit or we re-fetch to get the ID.
      let finalId = data.ID;
      if (!finalId) {
        await apiCall('getAllStaffData').then(d => {
          currentStaffData = d;
          const savedStaff = d.find(s => s.FolderNumber === data.FolderNumber);
          if (savedStaff) finalId = savedStaff.ID;
        });
      }

      if (finalId) {
        const uploadRes = await apiCall('uploadPassport', {
          currentUser,
          staffId: finalId,
          base64Data: pureBase64,
          filename: file.name,
          mimeType: file.type
        });
        if (!uploadRes.success) throw new Error("Staff saved, but image upload failed: " + uploadRes.message);
      }
    }

    closeStaffModal();
    showToast('Record saved successfully!');
    loadStaffDirectory(true);

    if (res.flags && res.flags.length > 0) {
      setTimeout(() => alert("Screening Flags Detected:\n- " + res.flags.join("\n- ")), 500);
    }
  } catch (err) {
    document.getElementById('modal-feedback').className = 'feedback-msg error';
    document.getElementById('modal-feedback').textContent = err.message || 'Server error.';
  }
}

function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// ------------------------------------------
// CSV UPLOAD
// ------------------------------------------
function handleCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    showToast('Parsing CSV...', 'success');

    const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()));

    if (rows.length > 0 && rows[0][0] && rows[0][0].toLowerCase().includes('name')) {
      rows.shift();
    }

    apiCall('processBulkUpload', { currentUser, rows })
      .then(res => {
        if (res.success) {
          showToast(res.message, 'success');
          if (res.errors.length > 0) {
            console.warn("CSV Upload Errors:", res.errors);
            alert("Upload completed with some errors:\n" + res.errors.join('\n'));
          }
          loadStaffDirectory(true);
        } else {
          showToast(res.message, 'error');
        }
      })
      .catch(err => {
        showToast('Server error during upload.', 'error');
      });
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ------------------------------------------
// USER MANAGEMENT
// ------------------------------------------
let currentUsersData = [];

function loadUsers() {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="spinner"></div> Loading users...</td></tr>';

  apiCall('getAllUsers')
    .then(data => {
      currentUsersData = data;
      renderUserTable(data);
    })
    .catch(err => {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:red;">Error loading users.</td></tr>';
    });
}

function renderUserTable(data) {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '';
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No users found.</td></tr>';
    return;
  }
  data.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-medium">${escapeHtml(u.Username)}</td>
      <td>${escapeHtml(u.Name)}</td>
      <td><span class="badge ${u.Role === 'Admin' ? 'badge-senior' : 'badge-junior'}">${escapeHtml(u.Role)}</span></td>
      <td>${escapeHtml(u.Email)}</td>
      <td>
        <button class="btn btn-text" style="padding: 4px 8px" onclick="editUser('${escapeHtml(u.ID)}')">Edit</button>
        <button class="btn btn-text" style="padding: 4px 8px; color: red;" onclick="deleteUser('${escapeHtml(u.ID)}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openUserModal() {
  document.getElementById('user-form').reset();
  document.getElementById('u-id').value = '';
  document.getElementById('user-modal-title').textContent = 'Add New User';
  document.getElementById('user-modal-feedback').textContent = '';
  document.getElementById('user-modal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

function editUser(id) {
  const user = currentUsersData.find(u => u.ID === id);
  if (!user) return;
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('u-id').value = user.ID;
  document.getElementById('u-username').value = user.Username || '';
  document.getElementById('u-password').value = '';
  document.getElementById('u-name').value = user.Name || '';
  document.getElementById('u-email').value = user.Email || '';
  document.getElementById('u-role').value = user.Role || 'Admin';

  document.getElementById('user-modal-feedback').textContent = '';
  document.getElementById('user-modal').classList.remove('hidden');
}

function submitUserForm() {
  const data = {
    ID: document.getElementById('u-id').value,
    Username: document.getElementById('u-username').value,
    Password: document.getElementById('u-password').value,
    Name: document.getElementById('u-name').value,
    Email: document.getElementById('u-email').value,
    Role: document.getElementById('u-role').value,
  };

  if (!data.Username || !data.Name) {
    document.getElementById('user-modal-feedback').className = 'feedback-msg error';
    document.getElementById('user-modal-feedback').textContent = 'Username and Name are required.';
    return;
  }

  document.getElementById('user-modal-feedback').textContent = 'Saving...';

  apiCall('saveUserRecord', { currentUser, data })
    .then(res => {
      if (res.success) {
        closeUserModal();
        showToast('User saved successfully!');
        loadUsers();
      } else {
        document.getElementById('user-modal-feedback').className = 'feedback-msg error';
        document.getElementById('user-modal-feedback').textContent = res.message;
      }
    })
    .catch(err => {
      document.getElementById('user-modal-feedback').className = 'feedback-msg error';
      document.getElementById('user-modal-feedback').textContent = 'Server error.';
    });
}

function deleteUser(id) {
  if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) return;
  showToast('Deleting user...', 'success');

  apiCall('toggleUserStatus', { currentUser, id })
    .then(res => {
      showToast(res.message, res.success ? 'success' : 'error');
      if (res.success) loadUsers();
    })
    .catch(err => showToast('Server error.', 'error'));
}


// ------------------------------------------
// AI CHATBOT SYSTEM
// ------------------------------------------
let isAIChatOpen = false;

function toggleAIChat() {
  isAIChatOpen = !isAIChatOpen;
  const widget = document.getElementById('ai-chat-widget');
  const btn = document.getElementById('ai-chat-btn');
  if (isAIChatOpen) {
    widget.style.display = 'flex';
    btn.style.transform = 'scale(0)';
  } else {
    widget.style.display = 'none';
    btn.style.transform = 'scale(1)';
  }
}

function addChatMessage(message, isUser = false) {
  const body = document.getElementById('ai-chat-body');
  const div = document.createElement('div');
  div.className = 'ai-msg';
  if (isUser) {
    div.style.background = 'var(--primary)';
    div.style.color = 'white';
    div.style.padding = '10px 14px';
    div.style.borderRadius = '12px 12px 0 12px';
    div.style.alignSelf = 'flex-end';
    div.style.maxWidth = '85%';
  } else {
    div.style.background = '#eef2ff';
    div.style.color = '#1e3a8a';
    div.style.padding = '10px 14px';
    div.style.borderRadius = '12px 12px 12px 0';
    div.style.alignSelf = 'flex-start';
    div.style.maxWidth = '85%';
  }
  div.textContent = message;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function sendAIMessage(promptText = null, isSilent = false) {
  const input = document.getElementById('ai-input');
  const text = promptText || input.value.trim();
  if (!text) return;

  if (!isSilent) {
    addChatMessage(text, true);
    input.value = '';
    // Show typing indicator
    addChatMessage('...', false);
  }

  // Provide current data as context
  let contextData = null;
  if (currentStaffData && currentStaffData.length > 0) {
    // Only send essential fields to save token space
    contextData = currentStaffData.map(s => ({
      FullName: s.FullName, FolderNumber: s.FolderNumber, Cadre: s.Cadre, StaffLevel: s.StaffLevel, Department: s.Department, GradeLevel: s.CurrentGradeLevel, Step: s.CurrentStep
    }));
  }

  apiCall('askAI', { currentUser, prompt: text, contextData })
    .then(res => {
      // Remove typing indicator
      const body = document.getElementById('ai-chat-body');
      if (body.lastChild.textContent === '...') body.removeChild(body.lastChild);

      if (res.success) {
        addChatMessage(res.reply);
      } else {
        addChatMessage("Error: " + res.message);
      }
    })
    .catch(err => {
      const body = document.getElementById('ai-chat-body');
      if (body.lastChild.textContent === '...') body.removeChild(body.lastChild);
      addChatMessage("Failed to connect to AI server.");
    });
}

function summarizeStaff() {
  const id = document.getElementById('f-id').value;
  const staff = currentStaffData.find(s => s.ID === id);
  if (!staff) return;

  if (!isAIChatOpen) toggleAIChat();

  addChatMessage("Please summarize the career progression of " + staff.FullName, true);
  addChatMessage('...', false);

  apiCall('askAI', { currentUser, prompt: "Provide a 2-paragraph professional HR summary of this staff member's career progression and qualifications.", contextData: [staff] })
    .then(res => {
      const body = document.getElementById('ai-chat-body');
      if (body.lastChild.textContent === '...') body.removeChild(body.lastChild);
      if (res.success) {
        addChatMessage(res.reply);
      } else {
        addChatMessage("Error: " + res.message);
      }
    });
}

// ------------------------------------------
// PWA SERVICE WORKER REGISTRATION
// ------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker registration failed', err));
  });
}

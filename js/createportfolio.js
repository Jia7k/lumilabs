const user = JSON.parse(localStorage.getItem("lumilabsSelectedUser"));

// Check if editing
const params = new URLSearchParams(window.location.search);
const editId = params.get("id") ? parseInt(params.get("id")) : null;
const statusLabel = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};
let originalPortfolio = null;

// LocalStorage helpers
function getPortfolios() {
  return JSON.parse(localStorage.getItem("portfolios")) || [];
}

function savePortfolios(portfolios) {
  localStorage.setItem("portfolios", JSON.stringify(portfolios));
}

function hasChanges() {
  if (!originalPortfolio) return false;

  return (
    document.getElementById("f-name").value !== originalPortfolio.name ||
    document.getElementById("f-sector").value !== originalPortfolio.sector ||
    document.getElementById("f-mvp_status").value !== originalPortfolio.mvp_status ||
    document.getElementById("f-funding_goal").value !== originalPortfolio.funding_goal ||
    document.getElementById("f-description").value !== originalPortfolio.description ||
    document.getElementById("f-team_size").value !== originalPortfolio.team_size ||
    document.getElementById("f-founded_year").value !== originalPortfolio.founded_year ||
    document.getElementById("f-location").value !== originalPortfolio.location ||
    document.getElementById("f-website").value !== originalPortfolio.website
  );
}

function updateSubmitBtn(status) {
  const submitBtn = document.getElementById("submit-btn");

  if (status === "approved") {
    submitBtn.style.display = hasChanges() ? "inline-flex" : "none";
  } else {
    submitBtn.style.display = "inline-flex";
  }
}

function init() {
  // Nav user info
  document.getElementById("user-avatar").innerText = user.name[0];
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = user.role.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());

  if (editId) {
    // Edit mode
    document.getElementById("page-title").innerText = "Edit Business Portfolio";
    const p = getPortfolios().find(p => p.id === editId);
    if (!p) { alert("Portfolio not found."); window.location.href = "mybusinesses.html"; return; }

    document.getElementById("page-sub").innerHTML = `
      <span class="badge ${p.status}">${statusLabel[p.status]}</span> · Readiness ${p.readiness_score}/100
    `;

    document.getElementById("f-name").value = p.name || "";
    document.getElementById("f-sector").value = p.sector || "";
    document.getElementById("f-mvp_status").value = p.mvp_status || "";
    document.getElementById("f-funding_goal").value = p.funding_goal || "";
    document.getElementById("f-description").value = p.description || "";
    document.getElementById("f-team_size").value = p.team_size || "";
    document.getElementById("f-founded_year").value = p.founded_year || "";
    document.getElementById("f-location").value = p.location || "";
    document.getElementById("f-website").value = p.website || "";

    originalPortfolio = {
      name: document.getElementById("f-name").value,
      sector: document.getElementById("f-sector").value,
      mvp_status: document.getElementById("f-mvp_status").value,
      funding_goal: document.getElementById("f-funding_goal").value,
      description: document.getElementById("f-description").value,
      team_size: document.getElementById("f-team_size").value,
      founded_year: document.getElementById("f-founded_year").value,
      location: document.getElementById("f-location").value,
      website: document.getElementById("f-website").value
    };

    document.querySelectorAll("input, textarea, select").forEach(el => {
      el.addEventListener("input", () => {
        updateSubmitBtn(p.status);
      });

      el.addEventListener("change", () => {
        updateSubmitBtn(p.status);
      });
    });

    updateSubmitBtn(p.status);
  }
}

// Save/Submit
function submitForm(status) {
  const name = document.getElementById("f-name").value.trim();
  const sector = document.getElementById("f-sector").value.trim();
  const mvp = document.getElementById("f-mvp_status").value.trim();
  const goal = document.getElementById("f-funding_goal").value;

  if (!name || !sector || !mvp || !goal) {
    alert("Please fill in all required fields (Company Name, Industry, MVP Status, Funding Goal).");
    return;
  }

  const portfolios = getPortfolios();
  const now = new Date().toISOString();

  if (editId) {
    // Update
    const idx = portfolios.findIndex(p => p.id === editId);
    portfolios[idx] = {
      ...portfolios[idx],
      name,
      sector,
      mvp_status: mvp,
      funding_goal: parseFloat(goal),
      description: document.getElementById("f-description").value.trim(),
      team_size: parseInt(document.getElementById("f-team_size").value) || null,
      founded_year: parseInt(document.getElementById("f-founded_year").value) || null,
      location: document.getElementById("f-location").value.trim(),
      website: document.getElementById("f-website").value.trim(),
      status: status === "pending" ? "pending" : (hasChanges() ? status : portfolios[idx].status),
      submitted_at: status === "pending" ? now : portfolios[idx].submitted_at,
      updated_at: now
    };
  } else {
    // Create
    portfolios.push({
      id: Date.now(),
      owner_id: user.key,
      name,
      sector,
      mvp_status: mvp,
      funding_goal: parseFloat(goal),
      description: document.getElementById("f-description").value.trim(),
      team_size: parseInt(document.getElementById("f-team_size").value) || null,
      founded_year: parseInt(document.getElementById("f-founded_year").value) || null,
      location: document.getElementById("f-location").value.trim(),
      website: document.getElementById("f-website").value.trim(),
      readiness_score: 0,
      status,
      rejection_reason: null,
      submitted_at: status === "pending" ? now : null,
      created_at: now,
      updated_at: now
    });
  }

  savePortfolios(portfolios);
  window.location.href = "mybusinesses.html";
}

// File Upload (UI only for now — wire to DB later)
let uploadedFiles = [];

function handleFiles(files) {
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { alert(`${file.name} exceeds 10MB.`); continue; }
    uploadedFiles.push(file);
  }
  renderFileList();
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById("upload-zone").classList.remove("drag-over");
  handleFiles(event.dataTransfer.files);
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  const container = document.getElementById("file-list");
  if (uploadedFiles.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML = uploadedFiles.map((f, i) => `
    <div class="pf-file-item">
      <i class="ti ti-file"></i>
      <span>${f.name}</span>
      <span class="pf-file-size">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="btn-ghost" onclick="removeFile(${i})"><i class="ti ti-x"></i></button>
    </div>
  `).join("");
}

init();
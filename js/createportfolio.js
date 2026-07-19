const params = new URLSearchParams(window.location.search);
const editId = params.get("id") ? parseInt(params.get("id")) : null;
const statusLabel = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};
let originalPortfolio = null;
let currentStatus = null; // status of the portfolio being edited (null if creating new)

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

async function init() {
  let user;
  try {
    user = await API.getCurrentUser();
  } catch (err) {
    alert("Your session has expired or is invalid. Please log in again.");
    return;
  }

  document.getElementById("user-avatar").innerText = user.name[0];
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = user.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  if (editId) {
    // EDIT MODE
    document.getElementById("page-title").innerText = "Edit Business Portfolio";

    let p;
    try {
      p = await API.getPortfolio(editId);
    } catch (err) {
      alert("Portfolio not found: " + err.message);
      window.location.href = "mybusinesses.html";
      return;
    }

    currentStatus = p.status;

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
      el.addEventListener("input", () => updateSubmitBtn(p.status));
      el.addEventListener("change", () => updateSubmitBtn(p.status));
    });

    updateSubmitBtn(p.status);
  }
}

function parseIntOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

// SAVE/SUBMIT
async function submitForm(status) {
  const name = document.getElementById("f-name").value.trim();
  const sector = document.getElementById("f-sector").value.trim();
  const mvp_status = document.getElementById("f-mvp_status").value.trim();
  const goal = document.getElementById("f-funding_goal").value;

  if (!name || !sector || !mvp_status || !goal) {
    alert("Please fill in all required fields (Company Name, Industry, MVP Status, Funding Goal).");
    return;
  }

  const funding_goal = parseFloat(goal);
  if (isNaN(funding_goal) || funding_goal < 0) {
    alert("Funding Goal must be a positive number.");
    return;
  }
 
  const team_size = parseIntOrNull(document.getElementById("f-team_size").value);
  if (team_size !== null && team_size < 0) {
    alert("Team Size can't be negative.");
    return;
  }
 
  const founded_year = parseIntOrNull(document.getElementById("f-founded_year").value);
  if (founded_year !== null && (founded_year < 1900 || founded_year > 2100)) {
    alert("Founded Year must be between 1900 and 2100.");
    return;
  }

  const payload = {
    name,
    sector,
    mvp_status,
    funding_goal: parseFloat(goal),
    description: document.getElementById("f-description").value.trim(),
    team_size,
    founded_year,
    location: document.getElementById("f-location").value.trim(),
    website: document.getElementById("f-website").value.trim()
  };

  try {
    let portfolioId = editId;

    if (editId) {
      // UPDATE
      if (!originalPortfolio || hasChanges() || status === "pending") {
        await API.updatePortfolio(editId, payload);
      }
    } else {
      // CREATE
      const created = await API.createPortfolio(payload);
      portfolioId = created.id;
    }

    // Move to pending review
    if (status === "pending") {
      await API.submitPortfolio(portfolioId);
    }

    window.location.href = "mybusinesses.html";
  } catch (err) {
    alert("Couldn't save portfolio: " + err.message);
  }
}

// FILE UPLOAD (UI only for now — wire to DB later)
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
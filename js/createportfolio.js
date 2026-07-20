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
    document.getElementById("f-website").value !== originalPortfolio.website ||
    document.getElementById("f-advisor_names").value !== originalPortfolio.advisor_names ||
    document.getElementById("f-monthly_revenue").value !== originalPortfolio.monthly_revenue ||
    document.getElementById("f-user_count").value !== originalPortfolio.user_count ||
    document.getElementById("f-growth_rate").value !== originalPortfolio.growth_rate ||
    document.getElementById("f-market_size").value !== originalPortfolio.market_size ||
    document.getElementById("f-competitor_analysis").value !== originalPortfolio.competitor_analysis ||
    document.getElementById("f-burn_rate").value !== originalPortfolio.burn_rate ||
    document.getElementById("f-runway_months").value !== originalPortfolio.runway_months
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
    document.getElementById("f-advisor_names").value = p.advisor_names || "";
    document.getElementById("f-monthly_revenue").value = p.monthly_revenue || "";
    document.getElementById("f-user_count").value = p.user_count || "";
    document.getElementById("f-growth_rate").value = p.growth_rate || "";
    document.getElementById("f-market_size").value = p.market_size || "";
    document.getElementById("f-competitor_analysis").value = p.competitor_analysis || "";
    document.getElementById("f-burn_rate").value = p.burn_rate || "";
    document.getElementById("f-runway_months").value = p.runway_months || "";
    existingDocuments = p.documents || [];
    renderFileList();
    
    originalPortfolio = {
      name: document.getElementById("f-name").value,
      sector: document.getElementById("f-sector").value,
      mvp_status: document.getElementById("f-mvp_status").value,
      funding_goal: document.getElementById("f-funding_goal").value,
      description: document.getElementById("f-description").value,
      team_size: document.getElementById("f-team_size").value,
      founded_year: document.getElementById("f-founded_year").value,
      location: document.getElementById("f-location").value,
      website: document.getElementById("f-website").value,
      advisor_names: document.getElementById("f-advisor_names").value,
      monthly_revenue: document.getElementById("f-monthly_revenue").value,
      user_count: document.getElementById("f-user_count").value,
      growth_rate: document.getElementById("f-growth_rate").value,
      market_size: document.getElementById("f-market_size").value,
      competitor_analysis: document.getElementById("f-competitor_analysis").value,
      burn_rate: document.getElementById("f-burn_rate").value,
      runway_months: document.getElementById("f-runway_months").value,
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

  const rawPayload = {
    name, sector, mvp_status,
    funding_goal: parseFloat(goal),
    description: document.getElementById("f-description").value.trim(),
    team_size, founded_year,
    location: document.getElementById("f-location").value.trim(),
    website: document.getElementById("f-website").value.trim(),
    advisor_names: document.getElementById("f-advisor_names").value.trim(),
    monthly_revenue: parseFloat(document.getElementById("f-monthly_revenue").value) || null,
    user_count: parseIntOrNull(document.getElementById("f-user_count").value),
    growth_rate: parseFloat(document.getElementById("f-growth_rate").value) || null,
    market_size: document.getElementById("f-market_size").value.trim(),
    competitor_analysis: document.getElementById("f-competitor_analysis").value.trim(),
    burn_rate: parseFloat(document.getElementById("f-burn_rate").value) || null,
    runway_months: parseIntOrNull(document.getElementById("f-runway_months").value),
  };
  const payload = rawPayload;

  try {
    let portfolioId = editId;

    if (editId) {
      // UPDATE
      if (!originalPortfolio || hasChanges() || status === "pending") {
        const result = await API.updatePortfolio(editId, payload);
        if (result.was_reset_to_draft) {
          alert("Your changes have been saved. Because your portfolio was under review, it has been returned to Draft — please re-submit when ready.");
          window.location.href = "mybusinesses.html";
          return;
        }
      }
    } else {
      // CREATE
      const created = await API.createPortfolio(payload);
      portfolioId = created.id;
    }

    // Upload any files now that there is a portfolio ID, has to happen after create/update
    if (pendingFiles.length > 0) {
      const result = await API.uploadDocuments(portfolioId, pendingFiles);
      existingDocuments = existingDocuments.concat(result.documents ? result.documents.filter(
        d => !existingDocuments.some(existing => existing.id === d.id)
      ) : []);
      pendingFiles = [];
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

// FILE UPLOAD
let existingDocuments = [];
let pendingFiles = [];

function handleFiles(files) {
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { alert(`${file.name} exceeds 10MB.`); continue; }
    pendingFiles.push(file);
  }
  renderFileList();
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById("upload-zone").classList.remove("drag-over");
  handleFiles(event.dataTransfer.files);
}

function removePendingFile(index) {
  pendingFiles.splice(index, 1);
  renderFileList();
}

async function removeExistingDocument(docId) {
  if (!editId) return;
  if (!confirm("Delete this document? This cannot be undone.")) return;

  try {
    await API.deleteDocument(editId, docId);
    existingDocuments = existingDocuments.filter(d => d.id !== docId);
    renderFileList();
  } catch (err) {
    alert("Couldn't delete document: " + err.message);
  }
}

function renderFileList() {
  const container = document.getElementById("file-list");

  const existingHtml = existingDocuments.map(d => `
    <div class="pf-file-item">
      <i class="ti ti-file"></i>
      <span>${d.file_name}</span>
      <span class="pf-file-size">Uploaded</span>
      <button class="btn-ghost" onclick="removeExistingDocument(${d.id})"><i class="ti ti-x"></i></button>
    </div>
  `).join("");

  const pendingHtml = pendingFiles.map((f, i) => `
    <div class="pf-file-item">
      <i class="ti ti-file"></i>
      <span>${f.name}</span>
      <span class="pf-file-size">${(f.size / 1024).toFixed(0)} KB · Pending save</span>
      <button class="btn-ghost" onclick="removePendingFile(${i})"><i class="ti ti-x"></i></button>
    </div>
  `).join("");

  container.innerHTML = existingHtml + pendingHtml;
}

init();
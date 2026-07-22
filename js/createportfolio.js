const params = new URLSearchParams(window.location.search);
let editId = params.get("id") ? Number.parseInt(params.get("id"), 10) : null;
let isSaving = false;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'doc', 'docx']);
const MAX_UPLOAD_FILES = 5;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const statusLabel = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};
let originalPortfolio = null;
let currentStatus = null; // status of the portfolio being edited (null if creating new)

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setSaving(saving) {
  isSaving = saving;
  document.querySelectorAll('[data-portfolio-save]').forEach((button) => {
    button.disabled = saving || currentStatus === "pending";
  });
}

function setFormLocked(locked) {
  document.querySelectorAll(".main input, .main textarea, .main select").forEach((field) => {
    field.disabled = locked;
  });
  document.querySelectorAll('[data-portfolio-save]').forEach((button) => {
    button.hidden = locked;
    button.disabled = locked;
  });
  const uploadZone = document.getElementById("upload-zone");
  if (uploadZone) {
    uploadZone.setAttribute("aria-disabled", String(locked));
    uploadZone.style.display = locked ? "none" : "";
  }
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

  if (status === "pending") {
    submitBtn.style.display = "none";
  } else if (status === "approved") {
    submitBtn.style.display = hasChanges() ? "inline-flex" : "none";
  } else {
    submitBtn.style.display = "inline-flex";
  }
}

function renderPortfolioSummary(status, readinessScore) {
  currentStatus = status;
  document.getElementById("page-sub").innerHTML = `
    <span class="badge ${status}">${statusLabel[status]}</span> · Readiness ${readinessScore}/100
    ${status === "pending" ? " · Pending review is in progress; editing is temporarily locked." : ""}
  `;
  updateSubmitBtn(status);
  setFormLocked(status === "pending");
}

function inputValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function parseIntegerOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? number : null;
}

function parseDecimalOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function populatePortfolioForm(portfolio) {
  const values = {
    "f-name": portfolio.name,
    "f-sector": portfolio.sector,
    "f-mvp_status": portfolio.mvp_status,
    "f-funding_goal": portfolio.funding_goal,
    "f-description": portfolio.description,
    "f-team_size": portfolio.team_size,
    "f-founded_year": portfolio.founded_year,
    "f-location": portfolio.location,
    "f-website": portfolio.website,
    "f-advisor_names": portfolio.advisor_names,
    "f-monthly_revenue": portfolio.monthly_revenue,
    "f-user_count": portfolio.user_count,
    "f-growth_rate": portfolio.growth_rate,
    "f-market_size": portfolio.market_size,
    "f-competitor_analysis": portfolio.competitor_analysis,
    "f-burn_rate": portfolio.burn_rate,
    "f-runway_months": portfolio.runway_months,
  };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).value = inputValue(value);
  }
}

function buildPortfolioPayload() {
  return {
    name: document.getElementById("f-name").value.trim(),
    sector: document.getElementById("f-sector").value.trim(),
    mvp_status: document.getElementById("f-mvp_status").value.trim(),
    funding_goal: parseDecimalOrNull(document.getElementById("f-funding_goal").value),
    description: document.getElementById("f-description").value.trim(),
    team_size: parseIntegerOrNull(document.getElementById("f-team_size").value),
    founded_year: parseIntegerOrNull(document.getElementById("f-founded_year").value),
    location: document.getElementById("f-location").value.trim(),
    website: document.getElementById("f-website").value.trim(),
    advisor_names: document.getElementById("f-advisor_names").value.trim(),
    monthly_revenue: parseDecimalOrNull(document.getElementById("f-monthly_revenue").value),
    user_count: parseIntegerOrNull(document.getElementById("f-user_count").value),
    growth_rate: parseDecimalOrNull(document.getElementById("f-growth_rate").value),
    market_size: document.getElementById("f-market_size").value.trim(),
    competitor_analysis: document.getElementById("f-competitor_analysis").value.trim(),
    burn_rate: parseDecimalOrNull(document.getElementById("f-burn_rate").value),
    runway_months: parseIntegerOrNull(document.getElementById("f-runway_months").value),
  };
}

async function init() {
  const user = await requirePageRole("business_owner");
  if (!user) return;

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

    populatePortfolioForm(p);
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
      el.addEventListener("input", () => updateSubmitBtn(currentStatus));
      el.addEventListener("change", () => updateSubmitBtn(currentStatus));
    });

    renderPortfolioSummary(p.status, p.readiness_score);
  }
}

// SAVE/SUBMIT
async function submitForm(status) {
  if (isSaving) return;
  setSaving(true);

  try {
    const payload = buildPortfolioPayload();
    const { name, sector, mvp_status, funding_goal, team_size, founded_year } = payload;

    if (!name || !sector || !mvp_status || document.getElementById("f-funding_goal").value.trim() === "") {
      alert("Please fill in all required fields (Company Name, Industry, MVP Status, Funding Goal).");
      return;
    }

    if (funding_goal === null || funding_goal < 0) {
      alert("Funding Goal must be zero or greater.");
      return;
    }

    if (team_size !== null && team_size < 0) {
      alert("Team Size can't be negative.");
      return;
    }

    if (founded_year !== null && (founded_year < 1900 || founded_year > 2100)) {
      alert("Founded Year must be between 1900 and 2100.");
      return;
    }

    let portfolioId = editId;

    if (editId) {
      // UPDATE
      if (!originalPortfolio || hasChanges() || status === "pending") {
        const result = await API.updatePortfolio(editId, payload);
        if (result.was_reset_to_draft && status === "draft") {
          alert("Your changes were saved and the portfolio returned to Draft for a fresh review.");
        }
      }
    } else {
      // CREATE
      const created = await API.createPortfolio(payload);
      editId = created.id;
      portfolioId = created.id;
      history.replaceState(null, '', `createportfolio.html?id=${created.id}`);
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
  } finally {
    setSaving(false);
  }
}

// FILE UPLOAD
let existingDocuments = [];
let pendingFiles = [];

function handleFiles(files) {
  if (currentStatus === "pending") return;
  for (const file of files) {
    const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      alert(`${file.name} is not a supported document type.`);
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`${file.name} exceeds 10MB.`);
      continue;
    }
    if (existingDocuments.length + pendingFiles.length >= MAX_UPLOAD_FILES) {
      alert(`You can attach up to ${MAX_UPLOAD_FILES} documents.`);
      break;
    }
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
  if (!editId || currentStatus === "pending") return;
  if (!confirm("Delete this document? This cannot be undone.")) return;

  try {
    const result = await API.deleteDocument(editId, docId);
    existingDocuments = existingDocuments.filter(d => d.id !== docId);
    renderPortfolioSummary("draft", result.readiness_score);
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
      <span>${escapeHtml(d.file_name)}</span>
      <span class="pf-file-size">Uploaded</span>
      ${currentStatus === "pending" ? "" : `<button class="btn-ghost" onclick="removeExistingDocument(${d.id})" aria-label="Remove ${escapeHtml(d.file_name)}"><i class="ti ti-x"></i></button>`}
    </div>
  `).join("");

  const pendingHtml = pendingFiles.map((f, i) => `
    <div class="pf-file-item">
      <i class="ti ti-file"></i>
      <span>${escapeHtml(f.name)}</span>
      <span class="pf-file-size">${(f.size / 1024).toFixed(0)} KB · Pending save</span>
      <button class="btn-ghost" onclick="removePendingFile(${i})"><i class="ti ti-x"></i></button>
    </div>
  `).join("");

  container.innerHTML = existingHtml + pendingHtml;
}

init();

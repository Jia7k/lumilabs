const CONTACT_FIELD_MESSAGES = Object.freeze({
  name: Object.freeze([
    "Enter your name.",
    "Name must be 100 characters or fewer.",
  ]),
  email: Object.freeze([
    "Enter your email address.",
    "Email must be 255 characters or fewer.",
    "Enter a valid email address.",
  ]),
  message: Object.freeze([
    "Message must be text.",
    "Message must be 5,000 characters or fewer.",
  ]),
});
const contactFormBindings = new WeakMap();

function contactCharacterCount(value) {
  return [...value].length;
}

function validateContactPayload({ name, email, message } = {}) {
  const errors = {};
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (!normalizedName) {
    errors.name = "Enter your name.";
  } else if (contactCharacterCount(normalizedName) > 100) {
    errors.name = "Name must be 100 characters or fewer.";
  }

  if (!normalizedEmail) {
    errors.email = "Enter your email address.";
  } else if (contactCharacterCount(normalizedEmail) > 255) {
    errors.email = "Email must be 255 characters or fewer.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }

  if (message !== undefined && typeof message !== "string") {
    errors.message = "Message must be text.";
  } else if (
    typeof message === "string"
    && contactCharacterCount(message.trim()) > 5000
  ) {
    errors.message = "Message must be 5,000 characters or fewer.";
  }

  return errors;
}

function contactServerErrors(error) {
  if (
    error?.status !== 400
    || !error.fields
    || typeof error.fields !== "object"
    || Array.isArray(error.fields)
  ) {
    return null;
  }

  const safeErrors = {};
  for (const [name, message] of Object.entries(error.fields)) {
    if (!Object.hasOwn(CONTACT_FIELD_MESSAGES, name)) return null;
    if (!CONTACT_FIELD_MESSAGES[name]?.includes(message)) return null;
    safeErrors[name] = message;
  }
  return Object.keys(safeErrors).length ? safeErrors : null;
}

function initializeContactForm({ root = document, api = API } = {}) {
  const form = root.getElementById("contact-form");
  if (!form) return null;
  const existingBinding = contactFormBindings.get(form);
  if (existingBinding) return existingBinding;

  const fields = {
    name: root.getElementById("contact-name"),
    email: root.getElementById("contact-email"),
    message: root.getElementById("contact-message"),
  };
  const errors = {
    name: root.getElementById("contact-name-error"),
    email: root.getElementById("contact-email-error"),
    message: root.getElementById("contact-message-error"),
  };
  const honeypot = root.getElementById("contact-company-website");
  const submit = root.getElementById("contact-submit");
  const status = root.getElementById("contact-status");
  let submissionPending = false;

  function payload() {
    return {
      name: fields.name.value.trim(),
      email: fields.email.value.trim(),
      message: fields.message.value.trim(),
      company_website: honeypot.value.trim(),
    };
  }

  function renderErrors(nextErrors) {
    for (const name of Object.keys(fields)) {
      errors[name].textContent = nextErrors[name] || "";
      if (nextErrors[name]) {
        fields[name].setAttribute("aria-invalid", "true");
      } else {
        fields[name].removeAttribute("aria-invalid");
      }
    }
  }

  function clearStatus() {
    status.textContent = "";
    status.className = "form-message";
  }

  function setFieldsReadOnly(readOnly) {
    for (const field of Object.values(fields)) {
      field.readOnly = readOnly;
    }
  }

  function syncEligibility() {
    const nextErrors = validateContactPayload(payload());
    submit.disabled = submissionPending || Object.keys(nextErrors).length > 0;
  }

  form.addEventListener("input", () => {
    renderErrors({});
    clearStatus();
    syncEligibility();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submissionPending) return;

    const submission = payload();
    const nextErrors = validateContactPayload(submission);
    renderErrors(nextErrors);
    const firstInvalid = Object.keys(fields).find((name) => nextErrors[name]);
    if (firstInvalid) {
      fields[firstInvalid].focus();
      syncEligibility();
      return;
    }

    submissionPending = true;
    setFieldsReadOnly(true);
    submit.disabled = true;
    submit.textContent = "Sending…";
    clearStatus();

    try {
      await api.submitContact(submission);
      form.reset();
      renderErrors({});
      status.textContent = "Message received. We'll get back to you soon.";
      status.className = "form-message success";
      status.focus();
    } catch (error) {
      const serverErrors = contactServerErrors(error);
      if (serverErrors) {
        renderErrors(serverErrors);
        const firstServerInvalid = Object.keys(fields)
          .find((name) => serverErrors[name]);
        fields[firstServerInvalid].focus();
      } else {
        status.textContent =
          "We couldn't send your message. Your text is still here—please retry.";
        status.className = "form-message error";
        status.focus();
      }
    } finally {
      submissionPending = false;
      setFieldsReadOnly(false);
      submit.textContent = "Send Message";
      syncEligibility();
    }
  });

  syncEligibility();
  const binding = { syncEligibility };
  contactFormBindings.set(form, binding);
  return binding;
}

initializeContactForm();

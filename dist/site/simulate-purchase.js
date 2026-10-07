/**
 * Simulated purchase, for testing the licence flow without taking payment.
 *
 * Why this exists
 * ---------------
 * Testing that a customer can activate TeleMouse normally requires a real
 * card payment. That is slow, costs money, and is awkward to repeat. This
 * talks to the licence server's /simulate endpoint instead, which issues a
 * real Keygen licence through exactly the same code path a genuine purchase
 * uses. The only thing removed is the payment.
 *
 * How to use it
 * -------------
 *   1. Start the licence server locally:
 *
 *        cd ~/dev/telemouse
 *        export KEYGEN_ADMIN_TOKEN=...      # real admin token
 *        export STRIPE_WEBHOOK_SECRET=whsec_dev
 *        export TELEMOUSE_ALLOW_SIMULATE=1
 *        python3 server/license_server.py
 *
 *   2. Serve this site locally (file:// will not work, because the page has to
 *      make a cross-origin request):
 *
 *        cd ~/dev/company-website/dist/site
 *        python3 -m http.server 8080
 *
 *   3. Open http://localhost:8080/products/ and use the Test purchase panel.
 *
 * The panel only appears when the page is opened from localhost, so it cannot
 * be reached by a real visitor on the live site even if this file is deployed.
 *
 * Security note
 * -------------
 * The admin token never touches the browser. The page only talks to your local
 * licence server, which holds the token server-side. That is the same split the
 * production flow relies on.
 */

const SIMULATE = {
  // Where the licence server is listening during development.
  endpoint: "http://localhost:8787/simulate",
  // Emails a key to the customer. In production this is what the storefront
  // calls after payment succeeds; here it is driven by the popup's Send button.
  sendEndpoint: "http://localhost:8787/send-key",
  // Reports whether issued keys are real or mock.
  healthEndpoint: "http://localhost:8787/health",
  // How long to wait before giving up on the server.
  timeoutMs: 20000
};

/** True when this page is being served locally rather than from the live site. */
function isLocalDevelopment() {
  const { hostname, protocol } = window.location;
  return (
    protocol === "file:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local")
  );
}

/**
 * Ask the server whether the keys it issues are real Keygen licences or ones
 * invented by a local mock.
 *
 * This matters more than it looks. A mock key has exactly the same shape as a
 * real one and is accepted by the local mock server, so it activates perfectly
 * during testing while not existing in the Keygen account at all. Without a
 * clear marker the two are indistinguishable, and the first sign of trouble is
 * a customer whose key nothing recognises.
 */
async function fetchKeygenMode() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(SIMULATE.healthEndpoint, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Post to the licence server, with a timeout so a wrong endpoint does not leave
 * the button spinning forever.
 */
async function postToServer(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIMULATE.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    // Read the body regardless of status: the server explains refusals in the
    // JSON body, and that explanation is the useful part.
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a transport failure into something a person can act on. */
function describeError(error) {
  if (error.name === "AbortError") {
    return "The licence server did not respond. Is it running?";
  }
  if (error.message === "Failed to fetch") {
    return "Could not reach the licence server. Start it with: python3 server/license_server.py";
  }
  return error.message || "Something went wrong.";
}

async function requestSimulatedLicense(email) {
  return postToServer(SIMULATE.endpoint, { email });
}

async function requestKeyEmail(email, licenseKey) {
  return postToServer(SIMULATE.sendEndpoint, { email, licenseKey });
}

/** Render the outcome inside the panel. */
function setSimulateStatus(root, message, state = "info") {
  const status = root.querySelector("[data-simulate-status]");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = state;
  status.hidden = !message;
}

/** An inline SVG key, so the popup needs no font or image dependency. */
function keyIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("key-dialog__icon");

  // A shaft with a bow (the round handle) and two teeth.
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute(
    "d",
    "M15.5 8.5a3.5 3.5 0 1 0-3.4 3.5L11 13H9v2H7v2H4v-3l7.1-7.1"
  );
  svg.append(path);

  return svg;
}

/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard needs a secure context, which covers localhost but not a
 * plain-http page on a LAN address. The textarea fallback keeps the button
 * working there, and is invisible either way.
 */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.top = "-1000px";
  scratch.style.opacity = "0";
  document.body.append(scratch);
  scratch.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  scratch.remove();
  return ok;
}

/** Build the popup shown once a licence has been issued. */
function createKeyDialog({ licenseKey, onSend }) {
  const overlay = document.createElement("div");
  overlay.className = "key-overlay";

  const dialog = document.createElement("div");
  dialog.className = "key-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "key-dialog-title");

  // --- header ---------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "key-dialog__header";

  const title = document.createElement("h2");
  title.className = "key-dialog__title";
  title.id = "key-dialog-title";
  title.textContent = "Your licence key";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "key-dialog__close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "✕";

  header.append(title, closeButton);

  // --- key row:  [key icon] [key] [Copy] ------------------------------------
  const keyRow = document.createElement("div");
  keyRow.className = "key-dialog__row";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "key-dialog__copy";
  copyButton.textContent = "Copy";

  const keyValue = document.createElement("code");
  keyValue.className = "key-dialog__value";
  keyValue.textContent = licenseKey;

  keyRow.append(keyIcon(), keyValue, copyButton);

  // --- "Key copied to clipboard." ------------------------------------------
  const toast = document.createElement("p");
  toast.className = "key-dialog__toast";
  toast.setAttribute("role", "status");
  // Reserve the space and fade the text, rather than toggling display, so the
  // dialog does not jump when the message appears.
  toast.setAttribute("aria-live", "polite");

  // --- email row:  [email field] [Send] ------------------------------------
  const sendRow = document.createElement("div");
  sendRow.className = "key-dialog__row key-dialog__row--send";

  const emailField = document.createElement("input");
  emailField.type = "email";
  emailField.className = "key-dialog__email";
  emailField.placeholder = "you@example.com";
  emailField.setAttribute("aria-label", "Email address");
  emailField.autocomplete = "off";
  emailField.spellcheck = false;

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "key-dialog__send";
  sendButton.textContent = "Send";

  sendRow.append(emailField, sendButton);

  dialog.append(header, keyRow, toast, sendRow);
  overlay.append(dialog);

  // --- behaviour ------------------------------------------------------------

  let toastTimer = null;
  function showToast(message, state = "info") {
    toast.textContent = message;
    toast.dataset.state = state;
    toast.classList.add("is-visible");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
      toastTimer = null;
    }, 2400);
  }

  copyButton.addEventListener("click", async () => {
    const copied = await copyText(licenseKey);
    if (copied) {
      copyButton.textContent = "Copied";
      copyButton.classList.add("is-done");
      setTimeout(() => {
        copyButton.textContent = "Copy";
        copyButton.classList.remove("is-done");
      }, 1500);
      showToast("Key copied to clipboard.");
    } else {
      showToast("Could not copy automatically. Select the key and copy it.", "error");
    }
  });

  async function submitSend() {
    const email = emailField.value.trim();

    if (!email || !email.includes("@")) {
      showToast("Enter an email address to send the key to.", "error");
      emailField.focus();
      return;
    }

    sendButton.disabled = true;
    const originalLabel = sendButton.textContent;
    sendButton.textContent = "Sending…";

    try {
      await onSend(email);
      sendButton.textContent = "Sent";
      showToast(`Key sent to ${email}.`);
      setTimeout(() => {
        sendButton.textContent = originalLabel;
      }, 1500);
    } catch (error) {
      sendButton.textContent = originalLabel;
      showToast(error.message || "Could not send the email.", "error");
    } finally {
      sendButton.disabled = false;
    }
  }

  sendButton.addEventListener("click", submitSend);
  // Enter in the email field should do the obvious thing.
  emailField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSend();
    }
  });

  function remove() {
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      remove();
    }
  }

  document.addEventListener("keydown", onKeyDown);
  closeButton.addEventListener("click", remove);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      remove();
    }
  });

  return { overlay, remove, focus: () => emailField.focus() };
}

/** Replace the panel body with a summary and open the key popup. */
function showIssuedLicense(root, { email, licenseKey, licenseId }, onSend) {
  const result = root.querySelector("[data-simulate-result]");
  if (!result) {
    return;
  }

  result.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "simulate-result__heading";
  heading.textContent = "Licence issued";
  result.append(heading);

  const explain = document.createElement("p");
  explain.className = "simulate-result__note";
  explain.textContent =
    "This is a real Keygen licence. Copy the key from the popup and paste it " +
    "into TeleMouse to activate it, exactly as a customer would after " +
    "receiving the email.";
  result.append(explain);

  // Keep the key available in the panel as well as the popup, so it can still
  // be retrieved after the popup has been dismissed.
  const keyRow = document.createElement("div");
  keyRow.className = "simulate-key";

  const keyCode = document.createElement("code");
  keyCode.textContent = licenseKey;
  keyRow.append(keyCode);

  const reopenButton = document.createElement("button");
  reopenButton.type = "button";
  reopenButton.className = "simulate-copy";
  reopenButton.textContent = "Show popup";
  reopenButton.addEventListener("click", () => {
    const popup = createKeyDialog({ licenseKey, onSend });
    document.body.append(popup.overlay);
    popup.focus();
  });
  keyRow.append(reopenButton);
  result.append(keyRow);

  const meta = document.createElement("p");
  meta.className = "simulate-result__meta";
  meta.textContent = `Issued to ${email} · licence ${String(licenseId).slice(0, 8)}`;
  result.append(meta);

  result.hidden = false;

  // Open the popup immediately: that is the point of the button.
  const popup = createKeyDialog({ licenseKey, onSend });
  document.body.append(popup.overlay);
  popup.focus();
}

/** Show whether the server issues real Keygen licences or mock ones. */
function renderKeygenMode(root, health) {
  const badge = root.querySelector("[data-simulate-mode]");
  if (!badge) {
    return;
  }

  if (!health) {
    badge.textContent = "Licence server not reachable";
    badge.dataset.mode = "unknown";
    badge.hidden = false;
    return;
  }

  if (health.mode === "mock") {
    badge.textContent =
      "MOCK KEYS: these licences do not exist in your Keygen account";
    badge.dataset.mode = "mock";
  } else {
    badge.textContent = "REAL KEYS: these licences are created in Keygen";
    badge.dataset.mode = "real";
  }
  badge.hidden = false;
}

function initSimulatePanel() {
  const root = document.querySelector("[data-simulate-purchase]");
  if (!root) {
    return;
  }

  // Never show this to a real visitor. The server would refuse the request
  // anyway, but the button should not be visible on the live site at all.
  if (!isLocalDevelopment()) {
    root.hidden = true;
    return;
  }

  root.hidden = false;

  const button = root.querySelector("[data-simulate-button]");
  const emailField = root.querySelector("[data-simulate-email]");
  if (!button) {
    return;
  }

  // Label the panel with what it actually produces, before anything is clicked.
  fetchKeygenMode().then((health) => renderKeygenMode(root, health));

  button.addEventListener("click", async () => {
    const email = (emailField?.value || "").trim() || "customer@example.com";

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Issuing…";
    setSimulateStatus(root, "Contacting the licence server…");

    try {
      const issued = await requestSimulatedLicense(email);
      setSimulateStatus(root, "");
      showIssuedLicense(root, issued, (toEmail) => requestKeyEmail(toEmail, issued.licenseKey));
    } catch (error) {
      setSimulateStatus(root, describeError(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

document.addEventListener("DOMContentLoaded", initSimulatePanel);

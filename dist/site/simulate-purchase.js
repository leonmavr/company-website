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
 * Post to the licence server, with a timeout so a wrong endpoint does not leave
 * the button spinning forever.
 */
async function requestSimulatedLicense(email) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIMULATE.timeoutMs);

  try {
    const response = await fetch(SIMULATE.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
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

/** Render the outcome inside the panel. */
function setSimulateStatus(root, message, state = "info") {
  const status = root.querySelector("[data-simulate-status]");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

/** Replace the panel body with the issued key and next steps. */
function showIssuedLicense(root, { email, licenseKey, licenseId }) {
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
    "This is a real Keygen licence. Paste the key into TeleMouse to activate " +
    "it, exactly as a customer would after receiving the email.";
  result.append(explain);

  // The key, selectable and copyable in one click.
  const keyRow = document.createElement("div");
  keyRow.className = "simulate-key";

  const keyCode = document.createElement("code");
  keyCode.textContent = licenseKey;
  keyRow.append(keyCode);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "simulate-copy";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1500);
    } catch {
      // Clipboard access can be blocked; the key is selectable regardless.
      copyButton.textContent = "Select manually";
    }
  });
  keyRow.append(copyButton);
  result.append(keyRow);

  const steps = document.createElement("ol");
  steps.className = "simulate-steps";
  [
    "Run TeleMouse, or ./cpp/build/telemouse_license status",
    "Paste the key when the activation dialog appears",
    "It binds to this computer, once"
  ].forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    steps.append(item);
  });
  result.append(steps);

  const meta = document.createElement("p");
  meta.className = "simulate-result__meta";
  meta.textContent = `Issued to ${email} · licence ${licenseId.slice(0, 8)}`;
  result.append(meta);

  result.hidden = false;
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

  button.addEventListener("click", async () => {
    const email = (emailField?.value || "").trim() || "customer@example.com";

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Issuing…";
    setSimulateStatus(root, "Contacting the licence server…");

    try {
      const issued = await requestSimulatedLicense(email);
      setSimulateStatus(root, "");
      showIssuedLicense(root, issued);
    } catch (error) {
      // A connection failure is the common case (server not running), and its
      // message is cryptic, so translate it into something actionable.
      const message =
        error.name === "AbortError"
          ? "The licence server did not respond. Is it running?"
          : error.message === "Failed to fetch"
            ? "Could not reach the licence server. Start it with: python3 server/license_server.py"
            : error.message;

      setSimulateStatus(root, message, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

document.addEventListener("DOMContentLoaded", initSimulatePanel);

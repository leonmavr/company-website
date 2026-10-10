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

// Where the licence server lives is defined once, in checkout.js, which is
// loaded before this file. Deriving from it rather than repeating the address
// means the test panel and the real checkout cannot end up pointed at different
// servers, which is the kind of mistake that makes a passing test meaningless.
const SIMULATE = {
  // Issues a licence without taking a payment.
  endpoint: `${licenseServerBase()}/simulate`,
  // Emails a key to the customer. In production this is what the storefront
  // calls after payment succeeds; here it is driven by the popup's Send button.
  sendEndpoint: `${licenseServerBase()}/send-key`,
  // Reports whether issued keys are real or mock, and where the app is hosted.
  healthEndpoint: `${licenseServerBase()}/health`,
  // Used only when the server does not report a download URL.
  fallbackDownloadUrl:
    "https://pub-50b544353f914584bfcea0ea99d78da1.r2.dev/Gesleap-linux-x64.zip",
  // How long to wait before giving up on the server.
  timeoutMs: 20000
};

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

// The key popup itself lives in key-dialog.js, which is loaded before this
// file. Sharing it means the test panel and the real checkout show a buyer the
// same thing, so what gets rehearsed here is what a customer actually sees.

/** Replace the panel body with a summary and open the key popup. */
function showIssuedLicense(root, { email, licenseKey, licenseId, simulated }, onSend, downloadUrl) {
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
  // Say where the key actually lives. A simulated licence is not in the Keygen
  // account, and calling it "real" is how one gets mistaken for a live key.
  explain.textContent = simulated
    ? "Issued by the local mock, so this key does NOT exist in your Keygen " +
      "account. It activates against the mock only, which is enough to test " +
      "the flow but is not a sale."
    : "This is a real Keygen licence. Copy the key from the popup and paste it " +
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
    const popup = createKeyDialog({ licenseKey, downloadUrl, onSend });
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
  const popup = createKeyDialog({ licenseKey, downloadUrl, onSend });
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

  // Where the customer downloads the app. The server owns this value so the
  // email and the popup cannot disagree; the fallback covers the case where the
  // health check has not answered yet or the server is older than this page.
  let downloadUrl = SIMULATE.fallbackDownloadUrl;

  // Label the panel with what it actually produces, before anything is clicked,
  // and take the download URL from the server while we are there.
  fetchKeygenMode().then((health) => {
    renderKeygenMode(root, health);
    if (health && health.downloadUrl) {
      downloadUrl = health.downloadUrl;
    }
  });

  button.addEventListener("click", async () => {
    const email = (emailField?.value || "").trim() || "customer@example.com";

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Issuing…";
    setSimulateStatus(root, "Contacting the licence server…");

    try {
      const issued = await requestSimulatedLicense(email);
      setSimulateStatus(root, "");
      showIssuedLicense(
        root,
        issued,
        (toEmail) => requestKeyEmail(toEmail, issued.licenseKey),
        downloadUrl
      );
    } catch (error) {
      setSimulateStatus(root, describeError(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

document.addEventListener("DOMContentLoaded", initSimulatePanel);

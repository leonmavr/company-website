/**
 * Buying the Full version.
 *
 * What this does
 * --------------
 * Shows the price, offers a button, takes a PayPal payment, and turns a
 * completed payment into a licence key with a download link -- the same key and
 * the same popup the test panel produces, reached by paying instead of by
 * pressing a test button.
 *
 * Where the decisions live
 * ------------------------
 * Almost none of them live here. The price, the currency and the download links
 * are read from the licence server, because a price in the page is a price the
 * buyer can edit, and the page has no way to know which builds are published.
 * This file's job is to ask, to display the answer, and to pass the order id
 * back to the server so the server can verify the payment itself.
 *
 * Nothing here decides whether a payment happened. The page reports what PayPal
 * told it and the server checks that against PayPal's own records; a page that
 * lies about an order id gets a refusal, not a key.
 *
 * Which is why there is no fallback button. If the licence server cannot be
 * reached, this says so. It does not quietly pretend to sell something.
 */

/**
 * Dev: the licence server running on this machine.
 *
 * 127.0.0.1 rather than localhost, matching the server's own bind address: on
 * Windows "localhost" resolves to ::1 first, while the server listens on IPv4
 * only, and the mismatch shows up as a connection refused that looks like the
 * server being down.
 */
const LICENSE_SERVER_DEV = "http://127.0.0.1:8787";

/**
 * Production: the deployed licence server.
 *
 * This was left empty while the server did not exist, so that a site deployed
 * early would say checkout was not open rather than fail on click. It exists
 * now: HTTPS with a Let's Encrypt certificate, reachable from here, and the
 * origin below is the one its CORS allows.
 *
 * A page can still override it without editing this file -- see
 * licenseServerBase() below.
 */
const LICENSE_SERVER_PROD = "https://license.gesleap.com";

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
 * The base URL of the licence server, without a trailing slash.
 *
 * A <meta name="gesleap-license-server" content="https://..."> tag wins, so a
 * staging deploy or a server on the local network can be pointed at without
 * editing this file or building anything.
 */
function licenseServerBase() {
  const meta = document.querySelector('meta[name="gesleap-license-server"]');
  const override = meta && meta.content ? meta.content.trim() : "";
  if (override) {
    return override.replace(/\/+$/, "");
  }
  return isLocalDevelopment() ? LICENSE_SERVER_DEV : LICENSE_SERVER_PROD;
}

const CHECKOUT = {
  configEndpoint: "/public-config",
  startEndpoint: "/checkout/start",
  completeEndpoint: "/checkout/complete",
  // Card payments go through Stripe instead, which is a redirect rather than a
  // button in this page: this only asks for a session and follows the URL.
  stripeStartEndpoint: "/checkout/stripe/start",
  // What happened to a card payment, asked when the buyer comes back. Returns
  // the licence, and issues it if the webhook did not arrive.
  stripeStatusEndpoint: "/checkout/stripe/status",
  // Generous, because completing a purchase waits on PayPal's own API from the
  // server, and a payment must not be abandoned because of an impatient client.
  timeoutMs: 45000,
  // The config check is only a page load, so it should not hang the button.
  configTimeoutMs: 6000,
  // How long to keep asking whether the licence exists, and how often. The
  // first attempt usually settles it, because the server issues the licence
  // itself if Stripe's webhook has not arrived; the retries cover the case
  // where the webhook is mid-flight and the amount check needs it to land.
  collectAttempts: 8,
  collectIntervalMs: 2500
};

const PLATFORM_LABELS = {
  windows: "Windows",
  // "Ubuntu" rather than "Ubuntu / Linux": the build targets Ubuntu and nothing
  // else is tested, so naming a whole family would promise more than is there.
  linux: "Ubuntu"
};

/**
 * Where to send someone when checkout is broken, filled from /public-config.
 *
 * Without it the only thing to say to a customer who cannot buy is "try again
 * later", which is useless when the problem is ours and not a blip.
 */
let supportEmail = "";

/**
 * Whether the licence server emails keys at all, from /public-config.
 *
 * Guards the resend button. Defaults to false, so a page that has not heard
 * from the server does not offer something the server may not do.
 */
let emailsKeys = false;

/** A human name for a platform id, falling back to the id itself. */
function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform;
}

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------

/** fetch with a timeout, returning the parsed body and reporting refusals. */
async function requestJSON(url, { method = "GET", body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs || CHECKOUT.timeoutMs
  );

  try {
    const options = { method, signal: controller.signal };
    if (body !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    // Read the body whatever the status: the server explains refusals in JSON,
    // and that explanation is the only useful part of a failure.
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail =
        (payload && (payload.detail || payload.error)) ||
        `the server answered HTTP ${response.status}`;
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }

    return payload || {};
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the server what it sells, for how much, and what it can hand out. */
async function fetchServerConfig() {
  return requestJSON(`${licenseServerBase()}${CHECKOUT.configEndpoint}`, {
    timeoutMs: CHECKOUT.configTimeoutMs
  });
}

/** Turn a failure into something a buyer can act on. */
function describeCheckoutError(error) {
  if (error.name === "AbortError") {
    return "The licence server did not answer. Your payment status is unchanged — please try again.";
  }

  // The server distinguishes these deliberately: 402 means it looked and found
  // no payment, 502 means it could not look at all. Telling a buyer the first
  // when the second is true would be telling them they did not pay.
  if (error.status === 402) {
    return "We could not confirm a payment for that order, so no licence was issued. If PayPal shows a charge, email us with your receipt and we will sort it out.";
  }
  if (error.status === 502) {
    return "We could not reach PayPal to confirm the payment. Nothing was lost — please try again in a moment.";
  }
  // 502 is the one case where retrying is worth suggesting, so it is the only
  // message that suggests it.
  if (error.status === 502) {
    return "We could not reach PayPal to confirm the payment. Nothing was lost — please try again in a moment.";
  }

  // 503 means PayPal answered and refused, or our own setup is wrong. Retrying
  // will fail the same way, so it is not offered: that would have someone
  // clicking the button forever. It is our problem and the message says so.
  if (error.status === 503) {
    return supportEmail
      ? `Checkout is unavailable right now. This is a problem on our side rather than yours, and trying again will not help — please email ${supportEmail} and we will take your order directly.`
      : "Checkout is unavailable right now. This is a problem on our side rather than yours, so please try again later.";
  }
  if (error.message === "Failed to fetch") {
    return `Could not reach the licence server at ${licenseServerBase()}.`;
  }
  return error.message || "Something went wrong.";
}

// ---------------------------------------------------------------------------
// Which system the visitor is on
// ---------------------------------------------------------------------------

/**
 * Guess which build the visitor needs, from what the browser reports.
 *
 * Only a guess, and deliberately treated as one: the picker is shown with the
 * guess pre-selected so a wrong answer costs one click, rather than being
 * hidden and costing a wrong download.
 *
 * navigator.userAgentData.platform is preferred over navigator.platform, which
 * is deprecated and which some browsers freeze to a fixed value.
 */
function detectPlatform() {
  const reported =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    "";
  const agent = navigator.userAgent || "";

  if (/windows|win32|win64|win/i.test(reported) || /Windows NT/i.test(agent)) {
    return "windows";
  }

  // Everything else -- Linux, macOS, phones, and browsers that report nothing
  // useful -- falls back to the one build that exists.
  return "linux";
}

/** The platform currently chosen in the picker. */
function currentPlatform(root) {
  const checked = root.querySelector("[data-os-option]:checked");
  return (checked && checked.value) || detectPlatform();
}

/**
 * Pre-select the detected platform and say that it was detected.
 *
 * The note is what makes the picker honest: without it, a pre-selected answer
 * reads as a question the visitor has to answer, and they may well change a
 * correct guess because they think they are being asked.
 */
function initPlatformPicker(root) {
  const options = Array.from(root.querySelectorAll("[data-os-option]"));
  if (!options.length) {
    return;
  }

  const detected = detectPlatform();
  const match = options.find((option) => option.value === detected);
  if (match) {
    match.checked = true;
  }

  const hint = root.querySelector("[data-os-hint]");
  if (hint) {
    // Dash rather than the em dash this used to have: the rest of the site's copy
  // avoids them.
  hint.textContent = `Detected ${platformLabel(detected)} - change it if that is wrong.`;
  }

  // The price and the download offered do not depend on the platform, but the
  // note about an unpublished build does, so re-render it when the choice moves.
  options.forEach((option) => {
    option.addEventListener("change", () => renderPlatformNote(root));
  });
}

/** Warn, quietly, when the chosen platform has no published build yet. */
function renderPlatformNote(root) {
  const note = root.querySelector("[data-platform-note]");
  if (!note || !root.dataset.checkoutPlatforms) {
    return;
  }

  let platforms = {};
  try {
    platforms = JSON.parse(root.dataset.checkoutPlatforms);
  } catch {
    return;
  }

  const chosen = currentPlatform(root);
  const entry = platforms[chosen];

  // Only ever says something when there is a problem. A note that appears for
  // the normal case is noise, and noise is what gets ignored.
  if (entry && entry.available === false) {
    note.textContent = `The ${platformLabel(chosen)} build is not published yet. The licence works the same, and we will email the download link as soon as it is available.`;
    note.hidden = false;
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function setCheckoutStatus(root, message, state = "info") {
  const status = root.querySelector("[data-checkout-status]");
  if (!status) {
    return;
  }

  status.textContent = message || "";
  status.dataset.state = state;
  status.hidden = !message;
}

/** "$0.01", using the currency the server actually charged in. */
function formatPrice(amount, currency) {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return `${amount} ${currency}`;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency
    }).format(value);
  } catch {
    // An unknown currency code throws. Showing the raw pair is better than
    // showing nothing on the one screen that has to state a price.
    return `${amount} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

/**
 * Load the PayPal SDK from the URL the server gave us.
 *
 * The URL is served rather than hardcoded so the sandbox and live setups cannot
 * drift: a page loading the live SDK with a sandbox client id fails with an
 * error naming neither.
 */
function loadPaypalSdk(url) {
  return new Promise((resolve, reject) => {
    if (window.paypal && typeof window.paypal.Buttons === "function") {
      resolve(window.paypal);
      return;
    }

    if (!url) {
      reject(new Error("The licence server did not provide a PayPal URL."));
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.addEventListener("load", () => {
      if (window.paypal && typeof window.paypal.Buttons === "function") {
        resolve(window.paypal);
      } else {
        reject(new Error("PayPal loaded but its buttons are unavailable."));
      }
    });
    script.addEventListener("error", () => {
      reject(new Error("Could not load PayPal. An ad blocker or a content filter can cause this."));
    });

    document.head.append(script);
  });
}

/**
 * Finish a purchase the buyer has approved in PayPal.
 *
 * The order id is the only thing sent. Everything else -- the amount, the
 * currency, the payer's address -- is read back from PayPal by the server,
 * because those are the facts a licence is issued on and this page could claim
 * anything at all.
 */
async function completePurchase(root, orderID) {
  const platform = currentPlatform(root);

  setCheckoutStatus(root, "Confirming the payment and preparing your key…");

  let result;
  try {
    result = await requestJSON(`${licenseServerBase()}${CHECKOUT.completeEndpoint}`, {
      method: "POST",
      body: { orderID, platform }
    });
  } catch (error) {
    console.error("checkout/complete failed", error);
    setCheckoutStatus(root, describeCheckoutError(error), "error");
    return;
  }

  setCheckoutStatus(root, "");
  showPurchasedLicense(result, platform);
}

/**
 * Show the key, the download, and where the key was emailed.
 *
 * Reuses the popup from key-dialog.js, so what the test panel rehearses is
 * literally what a paying customer is shown.
 *
 * `sessionId` is optional and only needed to offer the resend button, which is
 * itself only offered when the email did not go. A buyer whose key never
 * arrived otherwise has nothing but the copy button and a support address, and
 * the email is the record they keep.
 */
function showPurchasedLicense(result, platform, sessionId) {
  let note;

  if (result.emailed) {
    note = `We have emailed this key to ${result.email}.`;
  } else if (result.deliveryError) {
    note = `We could not email the key to ${result.email}, so please keep a copy of it now.`;
  } else {
    note = "Please keep a copy of this key — it is needed again if you reinstall.";
  }

  const options = {
    licenseKey: result.licenseKey,
    // Passed so the popup can name the file to run. The path differs per
    // platform, and the buyer chose the platform, so this is the one place that
    // knows which advice to give.
    platform,
    downloadUrl: result.downloadUrl || "",
    // Only reached when the server has no download URL for the chosen build.
    // Named from the platform rather than hardcoded per platform: this used to
    // single out Windows as unpublished, which stopped being true the moment
    // the Windows build shipped and would have gone on being wrong.
    downloadNote: `The ${platformLabel(
      platform
    )} build is not published yet. The licence works the same, and we will email the download link as soon as it is ready.`,
    note
  };

  // Offered only when the automatic send did not succeed, so the button is
  // never an invitation to send a second copy to someone who already has one.
  // Also requires the server to email keys at all: a deployment with delivery
  // switched off would otherwise offer a button that cannot work.
  if (sessionId && !result.emailed && emailsKeys) {
    options.resendEmail = result.email || "";
    options.onResend = async () => {
      const retry = await requestJSON(
        `${licenseServerBase()}${CHECKOUT.stripeStatusEndpoint}` +
          `?sessionId=${encodeURIComponent(sessionId)}&email=1`
      );
      if (!retry.emailed) {
        throw new Error(retry.deliveryError || "the server could not send it");
      }
    };
  }

  const dialog = createKeyDialog(options);

  document.body.append(dialog.overlay);
  dialog.focus();
}

/** Render the PayPal buttons for one price, reading the platform at click time. */
async function renderPaypalButtons(root, config) {
  const container = root.querySelector("[data-paypal-buttons]");
  if (!container) {
    return;
  }

  setCheckoutStatus(root, "Loading PayPal…");

  let paypal;
  try {
    paypal = await loadPaypalSdk(config.paypalSdkUrl);
  } catch (error) {
    console.error("paypal sdk", error);
    setCheckoutStatus(root, describeCheckoutError(error), "error");
    return;
  }

  container.innerHTML = "";

  // Set when we have already explained a failure ourselves, so the SDK's
  // generic onError handler does not overwrite a specific explanation with a
  // vaguer one. That happened: a restricted merchant account produced an
  // accurate "this is a problem on our side" message, which onError then
  // replaced with "nothing was charged -- please try again", advice that fails
  // identically every time and hides the real cause.
  let reportedFailure = false;

  paypal
    .Buttons({
      style: {
        shape: "rect",
        layout: "vertical",
        color: "gold",
        label: "paypal",
        height: 44
      },

      /**
       * Ask the server to open an order, and hand PayPal its id.
       *
       * The order is created server-side so the amount is fixed there. Created
       * here instead, the amount would come from this page, and a buyer who
       * edited it could pay whatever they liked for a licence.
       */
      async createOrder() {
        reportedFailure = false;
        setCheckoutStatus(root, "Starting checkout…");

        let started;
        try {
          started = await requestJSON(`${licenseServerBase()}${CHECKOUT.startEndpoint}`, {
            method: "POST",
            body: { platform: currentPlatform(root) }
          });
        } catch (error) {
          console.error("checkout/start failed", error);
          reportedFailure = true;
          setCheckoutStatus(root, describeCheckoutError(error), "error");
          // Rethrown because this is the documented way to abort the payment
          // flow: returning normally would hand PayPal an undefined order id.
          throw error;
        }

        if (!started.orderId) {
          reportedFailure = true;
          setCheckoutStatus(
            root,
            "Checkout could not be started. Please try again in a moment.",
            "error"
          );
          throw new Error("the licence server returned no order id");
        }

        // The order is open now and the buyer is about to be shown Paypal's
        // own window. "Starting checkout..." was still on screen while they
        // were choosing a funding source, which is no longer true -- and a
        // message that describes a finished step is how a page looks stuck.
        setCheckoutStatus(root, "Waiting for PayPal…");

        return started.orderId;
      },

      async onApprove(data) {
        await completePurchase(root, data.orderID);
      },

      onCancel() {
        // Nothing has been taken at this point, and saying so avoids a support
        // email from someone who clicked away and assumed the worst.
        setCheckoutStatus(root, "Checkout cancelled, and nothing was charged.", "info");
      },

      onError(error) {
        console.error("paypal error", error);

        // Only fills in when nothing more useful is on screen. The conditions
        // this fires for are also the ones the SDK reports after a createOrder
        // failure, and there the real explanation is already showing.
        if (reportedFailure) {
          return;
        }

        setCheckoutStatus(
          root,
          "PayPal could not complete the payment. Nothing was charged — please try again.",
          "error"
        );
      }
    })
    .render(container);

  setCheckoutStatus(root, "");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Render the Stripe card button, which redirects rather than opening a dialog. */
function renderCardButton(root, config, priceLabel) {
  const wrapper = root.querySelector("[data-card-checkout]");
  const button = root.querySelector("[data-card-button]");
  if (!wrapper || !button) {
    return;
  }

  const label = root.querySelector("[data-card-button-label]");
  if (label) {
    label.textContent = `Pay by card — ${priceLabel}`;
  }

  // Said plainly, because a test-mode shop takes no money while otherwise
  // behaving like a real one: a licence is still created and emailed, so
  // nothing else on the page would reveal it.
  const testNote = root.querySelector("[data-card-test]");
  if (testNote && config.cardCheckoutTestMode) {
    testNote.hidden = false;
  }

  wrapper.hidden = false;

  button.addEventListener("click", async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Opening secure checkout…";
    setCheckoutStatus(root, "");

    let started;
    try {
      started = await requestJSON(
        `${licenseServerBase()}${CHECKOUT.stripeStartEndpoint}`,
        { method: "POST", body: { platform: currentPlatform(root) } }
      );
    } catch (error) {
      console.error("stripe start failed", error);
      button.disabled = false;
      button.textContent = original;
      setCheckoutStatus(root, describeCheckoutError(error), "error");
      return;
    }

    if (!started.url) {
      button.disabled = false;
      button.textContent = original;
      setCheckoutStatus(
        root,
        "Checkout could not be started. Please try again in a moment.",
        "error"
      );
      return;
    }

    // Leave the button disabled. If the redirect is slow the buyer could
    // otherwise click again and open a second session, which would let them
    // pay twice.
    setCheckoutStatus(root, "Taking you to Stripe to pay…");
    window.location.href = started.url;
  });
}

/**
 * What to say if the buyer has just come back from Stripe's checkout.
 *
 * Stripe sends them to ?checkout=success or ?checkout=cancelled. Success also
 * carries the session id, which is what lets the key actually be shown -- see
 * collectStripeLicence. Without one there is nothing to look up, so this falls
 * back to telling them where the key is going.
 *
 * Returned rather than applied straight away, because the checkout code below
 * overwrites the status while it renders. Applying this last is what keeps it
 * on screen -- and it deserves to win, since by then the buyer has paid.
 */
function redirectOutcome() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }

  const outcome = params.get("checkout") || "";

  if (outcome === "success") {
    // When there is a session id, collectStripeLicence does the talking -- it
    // can report what actually happened rather than guessing.
    if (params.get("session_id")) {
      return null;
    }
    return {
      message:
        "Payment received. Your licence key is being emailed to you — it should arrive within a minute or two.",
      state: "info"
    };
  }

  if (outcome === "cancelled") {
    return {
      message: "Checkout cancelled, and nothing was charged.",
      state: "info"
    };
  }

  return null;
}

/** The Stripe session id Stripe substituted into the return URL, if any. */
function stripeSessionFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("session_id") || "";
  } catch {
    return "";
  }
}

/** Stop the session id sitting in the address bar.

 * It is the token that fetches a licence key, so it should not be left in the
 * URL to be shared, bookmarked, or picked up from history. Replaced rather than
 * removed so the back button does not simply re-add it.
 */
function forgetSessionInUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("session_id");
    url.searchParams.set("checkout", "success");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Cosmetic. Nothing breaks if the URL keeps its query string.
  }
}

/**
 * Collect the licence for a card payment that just completed.
 *
 * The buyer has paid and come back, and this is what turns that into a key on
 * screen. It asks the licence server, which verifies the session with Stripe
 * and issues the licence if nothing has yet -- so a webhook that never arrived
 * cannot leave a paying customer with nothing.
 *
 * The poll exists because the normal path is a race: Stripe's webhook may land
 * at any moment, and the first question may be asked before it does.
 */
async function collectStripeLicence(root) {
  const sessionId = stripeSessionFromUrl();
  if (!sessionId) {
    return;
  }

  setCheckoutStatus(root, "Confirming your payment…");

  for (let attempt = 0; attempt < CHECKOUT.collectAttempts; attempt += 1) {
    let result;
    try {
      result = await requestJSON(
        `${licenseServerBase()}${CHECKOUT.stripeStatusEndpoint}` +
          `?sessionId=${encodeURIComponent(sessionId)}`
      );
    } catch (error) {
      console.error("stripe status failed", error);
      break;
    }

    if (result.state === "issued") {
      forgetSessionInUrl();
      setCheckoutStatus(root, "");
      // The session id is passed on so the popup can offer to re-send the key
      // if the automatic email did not go.
      showPurchasedLicense(result, result.platform || "linux", sessionId);
      return;
    }

    if (result.state !== "pending") {
      // "unavailable", "unknown" or "failed" -- all cases where asking again
      // will not help.
      console.warn("stripe status could not confirm the purchase", result);
      break;
    }

    if (attempt < CHECKOUT.collectAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHECKOUT.collectIntervalMs));
    }
  }

  // Paid, but the key could not be collected. Say so honestly rather than
  // claiming an email that may never arrive -- and give them a way to reach a
  // person, because this is the one outcome that needs one.
  setCheckoutStatus(
    root,
    supportEmail
      ? `Your payment went through, but we could not fetch your licence key automatically. Email ${supportEmail} with your receipt and we will send it straight away.`
      : "Your payment went through, but we could not fetch your licence key automatically. Please contact support with your receipt.",
    "error"
  );
}

async function initCheckout() {
  // main.js's checkout code targets [data-paypal-button], which nothing in the
  // markup defines, so it exits immediately and never competes with this.
  const root = document.querySelector("[data-checkout]");
  if (!root) {
    return;
  }

  const outcome = redirectOutcome();

  initPlatformPicker(root);

  /** Shows the return-from-Stripe message, which outranks anything else. */
  function showOutcome() {
    if (outcome) {
      setCheckoutStatus(root, outcome.message, outcome.state);
    }
  }

  let config;
  try {
    config = await fetchServerConfig();
  } catch (error) {
    console.error("public-config failed", error);

    // A buyer returning from a successful payment is the one case where the
    // generic "the shop is not reachable" is the wrong thing to say: they have
    // already been charged, and telling them the shop is down reads as though
    // the payment failed. They need to know it went through and how to get
    // help.
    if (stripeSessionFromUrl()) {
      setCheckoutStatus(
        root,
        "Your payment went through, but our server is unreachable so we cannot show your licence key here. It should still reach you by email — if it does not arrive shortly, please contact support with your receipt.",
        "info"
      );
      return;
    }

    if (outcome) {
      showOutcome();
      return;
    }
    setCheckoutStatus(
      root,
      "The shop is not reachable right now, so buying is unavailable. Everything else on the site still works.",
      "error"
    );
    return;
  }

  // Used by describeCheckoutError, so a broken checkout can offer a way out
  // that is not "try again later" for ever.
  supportEmail = config.supportEmail || "";

  // Used by showPurchasedLicense, to decide whether offering to re-send the key
  // is offering something that can actually happen.
  emailsKeys = Boolean(config.emailsKeys);

  // Handed to renderPlatformNote, which reads it when the choice changes.
  root.dataset.checkoutPlatforms = JSON.stringify(
    Object.fromEntries((config.platforms || []).map((p) => [p.id, p]))
  );
  renderPlatformNote(root);

  const paypalAvailable = Boolean(config.checkoutEnabled);
  const cardAvailable = Boolean(config.cardCheckoutEnabled);

  if (!paypalAvailable && !cardAvailable) {
    // The price is deliberately left hidden. While nothing can be bought it
    // would only advertise a test figure -- the default is a cent -- next to a
    // message saying so, which reads as a broken shop rather than one that has
    // not opened.
    //
    // No provider is named. This used to say "Card and PayPal", which was
    // wrong the moment a shop stopped offering PayPal: it named a payment
    // method that had deliberately been removed.
    //
    // Still collect, if this is someone coming back from a payment: the method
    // being switched off for new buyers says nothing about a purchase that has
    // already been made.
    if (stripeSessionFromUrl()) {
      await collectStripeLicence(root);
    } else if (outcome) {
      showOutcome();
    } else {
      setCheckoutStatus(
        root,
        supportEmail
          ? `Payments are not open yet. Email ${supportEmail} if you would like to buy now.`
          : "Payments are not open yet. Check back shortly.",
        "info"
      );
    }
    return;
  }

  // The price comes from the server, so the page cannot disagree with what is
  // actually charged.
  const priceLabel = formatPrice(config.price, config.currency);

  const priceValue = root.querySelector("[data-checkout-price]");
  if (priceValue) {
    priceValue.textContent = priceLabel;
  }

  // The whole row starts hidden, so the page never shows a bare "One-time
  // payment" with no number beside it while the server is still answering.
  const priceRow = root.querySelector("[data-checkout-price-row]");
  if (priceRow) {
    priceRow.hidden = false;
  }

  if (cardAvailable) {
    renderCardButton(root, config, priceLabel);
  }

  if (paypalAvailable) {
    await renderPaypalButtons(root, config);
  }

  // The divider is a statement about the page, so it is only true when both
  // are on offer. Showing it with one method looks like something failed to
  // load.
  const divider = root.querySelector("[data-checkout-divider]");
  if (divider && cardAvailable && paypalAvailable) {
    divider.hidden = false;
  }

  // Last of all, and after the buttons, because it overwrites the status while
  // it works -- and because a buyer returning from a completed payment is the
  // one visitor whose message must not be clobbered by anything above.
  if (stripeSessionFromUrl()) {
    await collectStripeLicence(root);
  } else {
    showOutcome();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCheckout);
} else {
  initCheckout();
}

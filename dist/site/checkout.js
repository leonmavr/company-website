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
 * Left empty on purpose. Deploying this site before the server exists would
 * otherwise produce a Buy button that fails on click for every visitor, which
 * is worse than one that says it is not open yet.
 *
 * Set this to the server's public URL once it is running. A page can also
 * override it without editing this file -- see licenseServerBase().
 */
const LICENSE_SERVER_PROD = "";

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
  // Generous, because completing a purchase waits on PayPal's own API from the
  // server, and a payment must not be abandoned because of an impatient client.
  timeoutMs: 45000,
  // The config check is only a page load, so it should not hang the button.
  configTimeoutMs: 6000
};

const PLATFORM_LABELS = {
  windows: "Windows",
  linux: "Ubuntu / Linux"
};

/**
 * Where to send someone when checkout is broken, filled from /public-config.
 *
 * Without it the only thing to say to a customer who cannot buy is "try again
 * later", which is useless when the problem is ours and not a blip.
 */
let supportEmail = "";

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
  // 503 covers both "not configured" and "PayPal rejected our credentials".
  // They are the same thing from the buyer's side -- the shop is not working --
  // and neither is a statement about whether they paid.
  if (error.status === 503) {
    return supportEmail
      ? `Checkout is unavailable at the moment. Please try again later, or email ${supportEmail} and we will take your order directly.`
      : "Checkout is unavailable at the moment. Please try again later.";
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
    hint.textContent = `Detected ${platformLabel(detected)} — change it if that is wrong.`;
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
 * literally what a paying customer is shown. The row for emailing the key
 * somewhere else is deliberately absent: it has already gone to the address
 * that paid, and offering to send it again only invites mistakes.
 */
function showPurchasedLicense(result, platform) {
  let note;

  if (result.emailed) {
    note = `We have emailed this key to ${result.email}.`;
  } else if (result.deliveryError) {
    note = `We could not email the key to ${result.email}, so please keep a copy of it now.`;
  } else {
    note = "Please keep a copy of this key — it is needed again if you reinstall.";
  }

  const dialog = createKeyDialog({
    licenseKey: result.licenseKey,
    downloadUrl: result.downloadUrl || "",
    downloadNote:
      platform === "windows"
        ? "The Windows build is not published yet. We will email the download link as soon as it is ready."
        : "This build is not published yet.",
    note
  });

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
        setCheckoutStatus(root, "Starting checkout…");

        let started;
        try {
          started = await requestJSON(`${licenseServerBase()}${CHECKOUT.startEndpoint}`, {
            method: "POST",
            body: { platform: currentPlatform(root) }
          });
        } catch (error) {
          console.error("checkout/start failed", error);
          setCheckoutStatus(root, describeCheckoutError(error), "error");
          throw error;
        }

        if (!started.orderId) {
          const error = new Error("The licence server did not return an order id.");
          setCheckoutStatus(root, describeCheckoutError(error), "error");
          throw error;
        }

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

async function initCheckout() {
  // main.js's checkout code targets [data-paypal-button], which nothing in the
  // markup defines, so it exits immediately and never competes with this.
  const root = document.querySelector("[data-checkout]");
  if (!root) {
    return;
  }

  initPlatformPicker(root);

  let config;
  try {
    config = await fetchServerConfig();
  } catch (error) {
    console.error("public-config failed", error);
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

  // Handed to renderPlatformNote, which reads it when the choice changes.
  root.dataset.checkoutPlatforms = JSON.stringify(
    Object.fromEntries((config.platforms || []).map((p) => [p.id, p]))
  );
  renderPlatformNote(root);

  if (!config.checkoutEnabled) {
    // The price is deliberately left hidden. While checkout is closed it would
    // only advertise a test figure -- the default is a cent -- next to a
    // message saying nothing can be bought, which reads as a broken shop
    // rather than one that has not opened.
    setCheckoutStatus(
      root,
      supportEmail
        ? `Card and PayPal payments are not open yet. Email ${supportEmail} if you would like to buy now.`
        : "Card and PayPal payments are not open yet. Check back shortly.",
      "info"
    );
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

  await renderPaypalButtons(root, config);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCheckout);
} else {
  initCheckout();
}

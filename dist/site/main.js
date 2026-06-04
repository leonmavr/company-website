const CONTACT = {
  emailLabel: "Email",
  emailUser: "contact",
  emailDomain: "gesleap.com",
  address: "Gesleap OÜ, under Dalanta OÜ, Harju maakond, Tallinn, Pärnu mnt 105, 11312",
  linkedinLabel: "LinkedIn",
  linkedinUrl: "https://www.linkedin.com/in/lmavropalias/"
};

const SITE_COPY = {
  footerCopy: "Converting your gestures into input."
};

const navItems = Array.from(document.querySelectorAll(".nav-item.has-menu"));
const navToggles = Array.from(document.querySelectorAll(".nav-toggle"));

function getContactEmail() {
  return `${CONTACT.emailUser}@${CONTACT.emailDomain}`;
}

function hydrateContactInfo() {
  document.querySelectorAll('[data-contact="email-label"]').forEach((element) => {
    element.textContent = CONTACT.emailLabel;
  });

  document.querySelectorAll('[data-contact="address"]').forEach((element) => {
    element.textContent = CONTACT.address;
  });

  document.querySelectorAll('[data-contact="linkedin-label"]').forEach((element) => {
    element.textContent = CONTACT.linkedinLabel;
  });

  document.querySelectorAll('[data-contact="linkedin-url"]').forEach((element) => {
    if (element instanceof HTMLAnchorElement) {
      element.href = CONTACT.linkedinUrl;
    }
  });
}

function hydrateSiteCopy() {
  document.querySelectorAll('[data-site-copy="footer-copy"]').forEach((element) => {
    element.textContent = SITE_COPY.footerCopy;
  });
}

function closeMenus(exceptItem = null) {
  navItems.forEach((item) => {
    const isTarget = item === exceptItem;
    item.classList.toggle("is-open", isTarget);

    const toggle = item.querySelector(".nav-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(isTarget));
    }
  });
}

navToggles.forEach((toggle) => {
  toggle.addEventListener("click", (event) => {
    event.preventDefault();

    const item = toggle.closest(".nav-item");
    const shouldOpen = item && !item.classList.contains("is-open");
    closeMenus(shouldOpen ? item : null);
  });
});

document.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof Element) || !target.closest(".site-nav")) {
    closeMenus();
  }

  const emailTrigger = target instanceof Element ? target.closest('[data-action="reveal-email"]') : null;
  if (emailTrigger) {
    event.preventDefault();
    showEmailModal(getContactEmail());
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
  }
});

window.addEventListener("resize", () => closeMenus());

function showEmailModal(email) {
  const existing = document.querySelector(".email-overlay");
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement("div");
  overlay.className = "email-overlay";

  const dialog = document.createElement("div");
  dialog.className = "email-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Contact email");

  const closeButton = document.createElement("button");
  closeButton.className = "email-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "✕";

  const body = document.createElement("div");
  body.className = "email-body";

  const label = document.createElement("p");
  label.className = "email-label";
  label.textContent = "Gesleap contact";

  const text = document.createElement("p");
  text.className = "email-text";
  text.textContent = email;

  body.append(label, text);
  dialog.append(closeButton, body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const remove = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  };

  function onKeyDown(event) {
    if (event.key === "Escape") {
      remove();
    }
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      remove();
    }
  });

  closeButton.addEventListener("click", remove);
  document.addEventListener("keydown", onKeyDown);
}

function setPaypalResultMessage(container, message, isError = false) {
  const resultNode = container.querySelector("#paypal-result-message");
  if (!resultNode) {
    return;
  }

  resultNode.textContent = message;
  resultNode.classList.toggle("is-error", isError);
}

function initPaypalCheckout() {
  const checkoutRoot = document.querySelector("[data-paypal-button]");
  if (!checkoutRoot) {
    return;
  }

  const buttonContainer = checkoutRoot.querySelector("#paypal-button-container");
  if (!buttonContainer) {
    return;
  }

  if (!window.paypal || typeof window.paypal.Buttons !== "function") {
    setPaypalResultMessage(checkoutRoot, "PayPal checkout is unavailable right now. Please try again later.", true);
    return;
  }

  const productId = checkoutRoot.dataset.productId || "gesleap-full-version";
  const productName = checkoutRoot.dataset.productName || "Gesleap Full version";
  const amount = checkoutRoot.dataset.amount || "25.00";
  const currency = checkoutRoot.dataset.currency || "USD";
  const quantity = checkoutRoot.dataset.quantity || "1";

  const paypalButtons = window.paypal.Buttons({
    style: {
      shape: "rect",
      layout: "vertical",
      color: "gold",
      label: "paypal"
    },  
    async createOrder(data, actions) {
      return actions.order.create({
        purchase_units: [
          {
            custom_id: productId,
            description: productName,
            amount: {
              currency_code: currency,
              value: amount
            }
          }
        ],
        application_context: {
          shipping_preference: "NO_SHIPPING"
        }
      });
    },
    async onApprove(data, actions) {
      try {
        setPaypalResultMessage(checkoutRoot, "Verifying payment and preparing download...");

        const orderID = data.orderID || data.orderId;
        const objectKey = checkoutRoot.dataset.downloadKey || productId;

        const resp = await fetch('/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderID, objectKey })
        });

        const result = await resp.json().catch(() => null);
        if (!resp.ok) {
          const msg = (result && (result.error || result.details)) || 'server_error';
          setPaypalResultMessage(checkoutRoot, `Payment verified but download failed: ${msg}`, true);
          console.error('verify-payment error', result);
          return;
        }

        const downloadUrl = result && result.downloadUrl;
        if (!downloadUrl) {
          setPaypalResultMessage(checkoutRoot, 'Payment verified but no download URL returned.', true);
          console.error('no downloadUrl', result);
          return;
        }

        // Redirect user to the one-time download link
        window.location.href = downloadUrl;
      } catch (error) {
        console.error(error);
        setPaypalResultMessage(checkoutRoot, "Sorry, your transaction could not be processed.", true);
      }
    },
    onError(error) {
      console.error(error);
      setPaypalResultMessage(checkoutRoot, "Sorry, your transaction could not be processed.", true);
    }
  });

  if (typeof paypalButtons.isEligible === "function" && !paypalButtons.isEligible()) {
    setPaypalResultMessage(checkoutRoot, "PayPal checkout is not available for this browser or device.", true);
    return;
  }

  paypalButtons.render(buttonContainer).catch((error) => {
    console.error(error);
    setPaypalResultMessage(checkoutRoot, "PayPal checkout failed to load. Please refresh and try again.", true);
  });
}

hydrateContactInfo();
hydrateSiteCopy();
initPaypalCheckout();
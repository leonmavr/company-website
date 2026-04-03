const CONTACT = {
  emailLabel: "Email",
  emailUser: "contact",
  emailDomain: "gesleap.com",
  address: "Gesleap OÜ, under Dalanta OÜ, Harju maakond, Tallinn, Pärnu mnt 105, 11312",
  linkedinLabel: "LinkedIn",
  linkedinUrl: "https://www.linkedin.com/in/lmavropalias/"
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
    return;
  }

  const paymentTrigger = target instanceof Element ? target.closest('[data-action="show-payment-popup"]') : null;
  if (!paymentTrigger) {
    return;
  }

  event.preventDefault();
  showPaymentModal();
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

function showPaymentModal() {
  const existing = document.querySelector(".payment-overlay");
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement("div");
  overlay.className = "payment-overlay";

  const dialog = document.createElement("div");
  dialog.className = "payment-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Payment popup placeholder");

  const closeButton = document.createElement("button");
  closeButton.className = "payment-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "✕";

  const body = document.createElement("div");
  body.className = "payment-body";

  const label = document.createElement("p");
  label.className = "payment-label";
  label.textContent = "Checkout";

  const title = document.createElement("p");
  title.className = "payment-title";
  title.textContent = "Full version purchase";

  const copy = document.createElement("p");
  copy.className = "payment-copy";
  copy.textContent = "Payment is not implemented yet. This popup reserves the purchase flow area for future credit card and additional payment methods.";

  const actions = document.createElement("div");
  actions.className = "payment-actions";

  ["Credit card", "PayPal", "Bank transfer"].forEach((labelText) => {
    const chip = document.createElement("div");
    chip.className = "payment-method";
    chip.textContent = labelText;
    actions.appendChild(chip);
  });

  body.append(label, title, copy, actions);
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

hydrateContactInfo();
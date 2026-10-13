const CONTACT = {
  emailLabel: "Email",
  emailUser: "contact",
  emailDomain: "gesleap.com",
  address: "Gesleap OÜ, under Dalanta OÜ, Harju maakond, Tallinn, Pärnu mnt 105, 11312",
  linkedinLabel: "LinkedIn",
  linkedinUrl: "https://www.linkedin.com/in/lmavropalias/"
};

const SITE_COPY = {
  footerCopy: "Making gestures usable."
};

const navItems = Array.from(document.querySelectorAll(".nav-item.has-menu"));

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
    item.classList.toggle("is-open", item === exceptItem);

    // No aria-expanded to update: the parents are links whose submenu is shown
    // by hover and focus, not toggle buttons, so aria-haspopup is what describes
    // them and there is no state here for JS to keep in sync.
  });
}

/**
 * Close a submenu once something in it has been chosen.
 *
 * The parents are ordinary links and the submenu hangs off hover, so most
 * choices navigate and the menu leaves with the page. The exception is a link
 * pointing at an anchor on the page already open: that scrolls rather than
 * navigating, the pointer never leaves the menu, and the menu stays open on top
 * of the content the visitor just asked to see. Marking the item dismissed
 * closes it; the mouseenter handler below clears the mark for next time.
 */
const navDropdownLinks = Array.from(document.querySelectorAll(".nav-dropdown a"));

navDropdownLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const item = link.closest(".nav-item.has-menu");
    if (item) {
      item.classList.add("is-dismissed");
    }

    // Drop focus as well, or :focus-within holds the menu open on its own.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
});

navItems.forEach((item) => {
  item.addEventListener("mouseenter", () => item.classList.remove("is-dismissed"));
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

// The PayPal checkout code that used to live here has been removed.
//
// It looked for [data-paypal-button] and #paypal-button-container, neither of
// which appears anywhere in the markup, so it returned on its first line every
// time and nothing ran. The "Something went wrong" message visitors saw came
// from the hosted button configured in PayPal's dashboard instead -- a
// different mechanism entirely, which is why the code here looked innocent.
//
// Buying is now in checkout.js: the order is opened server-side so the price
// cannot be edited by the buyer, and the licence server verifies the payment
// against PayPal's own records before any key is issued.

hydrateContactInfo();
hydrateSiteCopy();
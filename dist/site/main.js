const tabs = Array.from(document.querySelectorAll('[data-tab]'));
const panels = Array.from(document.querySelectorAll('[data-panel]'));

function setActive(tabName) {
  for (const btn of tabs) {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  for (const panel of panels) {
    panel.classList.toggle('is-hidden', panel.dataset.panel !== tabName);
  }
}

tabs.forEach((btn) => {
  btn.addEventListener('click', () => setActive(btn.dataset.tab));
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();

  const action = el.dataset.action;
  if (action === 'contact') setActive('contact');
  if (action === 'demo') setActive('products');
});

/* Centralized contact info (edit here once) */
const CONTACT = {
  emailLabel: 'Email (click me)',
  emailUser: 'contact',
  emailDomain: 'gesleap.com',
  address: 'Gesleap OÜ, under Dalanta OÜ, Harju maakond, Tallinn, Pärnu mnt 105, 11312',
  linkedinLabel: 'LinkedIn',
  linkedinUrl: 'https://www.linkedin.com/',
};

function getContactEmail(){
  return `${CONTACT.emailUser}@${CONTACT.emailDomain}`;
}

function hydrateContactInfo(){
  document.querySelectorAll('[data-contact="email-label"]').forEach((el) => {
    el.textContent = CONTACT.emailLabel;
  });

  document.querySelectorAll('[data-contact="address"]').forEach((el) => {
    el.textContent = CONTACT.address;
  });

  document.querySelectorAll('[data-contact="linkedin-label"]').forEach((el) => {
    el.textContent = CONTACT.linkedinLabel;
  });

  document.querySelectorAll('[data-contact="linkedin-url"]').forEach((el) => {
    if (el instanceof HTMLAnchorElement) {
      el.href = CONTACT.linkedinUrl;
    }
  });
}

function _showEmailModal(email){
  const overlay = document.createElement('div');
  overlay.className = 'email-overlay';
  overlay.innerHTML = `
    <div class="email-dialog" role="dialog" aria-modal="true" aria-label="Contact email">
      <div class="email-inner">
        <button class="email-close" aria-label="Close">✕</button>
        <div class="email-body">
          <p class="email-text">${email}</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const remove = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(ev){ if (ev.key === 'Escape') remove(); }

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) remove(); });
  overlay.querySelector('.email-close').addEventListener('click', remove);
  document.addEventListener('keydown', onKey);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="reveal-email"]');
  if (!btn) return;
  e.preventDefault();
  _showEmailModal(getContactEmail());
});

// main.js is loaded with `defer`, so DOM is ready here.
hydrateContactInfo();

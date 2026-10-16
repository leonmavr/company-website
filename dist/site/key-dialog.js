/**
 * The licence-key popup, shared by the test panel and the real checkout.
 *
 * Why this is its own file
 * ------------------------
 * Two places now finish by showing someone a key: the local test panel, which
 * mints one without payment, and the real checkout, which mints one after a
 * payment clears. Both need the same key, the same copy button, the same
 * download link and the same clipboard fallback.
 *
 * Keeping one copy means the two cannot drift into showing a customer something
 * different from what the test panel showed, which is exactly the sort of
 * difference that only shows up in a screenshot from an annoyed buyer.
 *
 * Everything here is presentation. It never decides whether a key is valid, and
 * it never talks to a server -- the callers do that and pass the result in.
 */

/**
 * An inline SVG download arrow, matching the key icon.
 *
 * Inline rather than a font or an image file: the popup is the one thing a
 * paying customer must be able to read, and it should not depend on a
 * third-party asset being reachable.
 */
function downloadIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("key-dialog__icon");

  // Arrow into a tray.
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("d", "M12 3v11m0 0l-4-4m4 4l4-4M4 17v2.5h16V17");
  svg.append(path);

  return svg;
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
 *
 * Returns whether it worked, so the caller can say "copy this yourself" instead
 * of claiming success.
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

/*
 * Where the app is run from, once the download has been unzipped.
 *
 * Both archives put everything inside one folder named Gesleap, so the path is
 * relative to wherever the buyer extracted it -- which we cannot know, and
 * spelling out a home directory would be wrong for anyone who unzipped
 * somewhere else. A path relative to the download is right regardless.
 *
 * A path rather than "double-click the app": the licence prompt on first run is
 * where a buyer with a fresh download is most likely to stall, and being told
 * exactly what to run is what gets them past it.
 *
 * The two entries differ in more than the separator. On Windows the download
 * ends in a single .exe. On Linux it is a launcher script that points the
 * loader at the bundled libraries before starting the real binary next to it,
 * so that is the file to run.
 */
const LAUNCH_PATHS = {
  linux: "Gesleap/telemouse_overlay",
  windows: "Gesleap\\telemouse_overlay.exe"
};

/**
 * Build the popup shown once a licence has been issued.
 *
 * Options:
 *   licenseKey    the key to display (required)
 *   platform      which build was bought, e.g. "windows"; decides the path in
 *                 the instructions. An unknown or missing value drops the path
 *                 rather than guessing at one -- advice that is right for the
 *                 other platform is worse than no path at all
 *   downloadUrl   where to get the app; "" when that build is not published
 *   downloadNote  shown instead of a link when there is no downloadUrl
 *   note          a small line under the heading, e.g. "Emailed to you@x.com"
 *   onSend        optional; when given, a row to re-send the key is included
 *   onResend      optional; a single button that emails the key to the address
 *                 the payment came from. Used when that send did not succeed
 *   resendEmail   the address shown on that button
 *
 * `onSend` being optional is what lets the real checkout reuse this: there, the
 * key has already been emailed to the buyer, so offering to send it somewhere
 * else is clutter rather than a feature.
 *
 * Returns { overlay, remove, focus }.
 */
function createKeyDialog({
  licenseKey,
  platform,
  downloadUrl,
  downloadNote,
  note,
  onSend,
  onResend,
  resendEmail
}) {
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

  const children = [header];

  // --- optional note, e.g. "We emailed this to you" -------------------------
  if (note) {
    const noteLine = document.createElement("p");
    noteLine.className = "key-dialog__note";
    noteLine.textContent = note;
    children.push(noteLine);
  }

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
  children.push(keyRow);

  // --- download row:  [download icon] [url or note] [Copy] ------------------
  // The key is useless without the app, so the download is presented right
  // beside it rather than being something the customer has to go and find.
  //
  // When the build for the chosen platform is not published yet there is no URL
  // to offer, and a dead link is worse than an explanation, so the row says so
  // in the same place the link would have been.
  const downloadRow = document.createElement("div");
  downloadRow.className = "key-dialog__row key-dialog__row--download";

  let downloadCopy = null;

  if (downloadUrl) {
    downloadCopy = document.createElement("button");
    downloadCopy.type = "button";
    downloadCopy.className = "key-dialog__copy";
    downloadCopy.textContent = "Copy";

    const downloadLink = document.createElement("a");
    downloadLink.className = "key-dialog__download";
    downloadLink.href = downloadUrl;
    downloadLink.textContent = downloadUrl;
    // A download, not a page to navigate to.
    downloadLink.setAttribute("download", "");
    downloadLink.setAttribute("rel", "noopener");
    downloadLink.title = downloadUrl;

    downloadRow.append(downloadIcon(), downloadLink, downloadCopy);
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "key-dialog__download key-dialog__download--pending";
    unavailable.textContent =
      downloadNote || "This build is not published yet.";

    downloadRow.append(downloadIcon(), unavailable);
  }

  children.push(downloadRow);

  // --- "Key copied to clipboard." ------------------------------------------
  const toast = document.createElement("p");
  toast.className = "key-dialog__toast";
  toast.setAttribute("role", "status");
  // Reserve the space and fade the text, rather than toggling display, so the
  // dialog does not jump when the message appears.
  toast.setAttribute("aria-live", "polite");
  children.push(toast);

  // --- optional email row:  [email field] [Send] ---------------------------
  let emailField = null;
  let sendButton = null;

  if (typeof onSend === "function") {
    const sendRow = document.createElement("div");
    sendRow.className = "key-dialog__row key-dialog__row--send";

    emailField = document.createElement("input");
    emailField.type = "email";
    emailField.className = "key-dialog__email";
    emailField.placeholder = "you@example.com";
    emailField.setAttribute("aria-label", "Email address");
    emailField.autocomplete = "off";
    emailField.spellcheck = false;

    sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.className = "key-dialog__send";
    sendButton.textContent = "Send";

    sendRow.append(emailField, sendButton);
    children.push(sendRow);
  }

  // --- optional resend row ------------------------------------------------
  // A single button, not the email field the test panel uses. Here the address
  // is not the caller's to choose -- it is the one the payment was made from --
  // so offering a text box would be inviting input that gets ignored.
  let resendButton = null;

  if (typeof onResend === "function") {
    const resendRow = document.createElement("div");
    resendRow.className = "key-dialog__row key-dialog__row--send";

    resendButton = document.createElement("button");
    resendButton.type = "button";
    resendButton.className = "key-dialog__send key-dialog__send--wide";
    resendButton.textContent = resendEmail
      ? `Email this key to ${resendEmail}`
      : "Email me this key";

    resendRow.append(resendButton);
    children.push(resendRow);
  }

  // --- instructions, last ---------------------------------------------------
  //
  // The popup hands over a key and says nothing about what to do with it. This
  // is the answer, placed at the bottom and after everything actionable so it
  // reads as the closing step rather than competing with the key itself.
  //
  // The second sentence appears for every platform and every build, including
  // the freemium, because entering the key on first run is the same step
  // wherever the app came from. Only the path is platform-specific.
  const launchPath = LAUNCH_PATHS[platform];

  const instructions = document.createElement("p");
  instructions.className = "key-dialog__instructions";

  const instructionsLabel = document.createElement("strong");
  instructionsLabel.textContent = "Instructions: ";
  instructions.append(instructionsLabel);

  if (launchPath) {
    // In a code element because it is the one thing here to be typed or copied
    // by hand, and it should read as a path rather than as prose.
    const pathCode = document.createElement("code");
    pathCode.className = "key-dialog__path";
    pathCode.textContent = launchPath;

    instructions.append("run the binary at ", pathCode, ". ");
  }

  instructions.append(
    "The first time you run it, you will have to enter the licence key you received upon purchase."
  );

  children.push(instructions);

  dialog.append(...children);
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

  /** Same feedback pattern for both copy buttons, so they behave alike. */
  function wireCopyButton(button, value, label, message) {
    button.addEventListener("click", async () => {
      const copied = await copyText(value);
      if (copied) {
        button.textContent = "Copied";
        button.classList.add("is-done");
        setTimeout(() => {
          button.textContent = label;
          button.classList.remove("is-done");
        }, 1500);
        showToast(message);
      } else {
        showToast(`Could not copy the ${message}. Select it and copy manually.`, "error");
      }
    });
  }

  wireCopyButton(copyButton, licenseKey, "Copy", "Key copied to clipboard.");
  if (downloadCopy) {
    wireCopyButton(
      downloadCopy,
      downloadUrl,
      "Copy",
      "Download link copied to clipboard."
    );
  }

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

  if (sendButton) {
    sendButton.addEventListener("click", submitSend);
    // Enter in the email field should do the obvious thing.
    emailField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSend();
      }
    });
  }

  if (resendButton) {
    resendButton.addEventListener("click", async () => {
      resendButton.disabled = true;
      const original = resendButton.textContent;
      resendButton.textContent = "Sending…";

      try {
        await onResend();
        resendButton.textContent = "Sent";
        showToast(
          resendEmail ? `Key sent to ${resendEmail}.` : "Key sent."
        );
        setTimeout(() => {
          resendButton.textContent = original;
          resendButton.disabled = false;
        }, 1800);
      } catch (error) {
        resendButton.textContent = original;
        resendButton.disabled = false;
        showToast(error.message || "Could not send the email.", "error");
      }
    });
  }

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

  return {
    overlay,
    remove,
    // Where the cursor belongs: the email field when there is one to fill in,
    // otherwise the thing the visitor most likely came here to do.
    focus: () => (emailField || resendButton || copyButton).focus()
  };
}

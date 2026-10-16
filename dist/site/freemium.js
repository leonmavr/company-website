/**
 * Downloading the Free edition.
 *
 * What this does
 * --------------
 * Opens the licence popup for a free download: the link for the visitor's
 * system, and what to do with it once it is unzipped.
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * Anything involving the licence server. There is no payment, no key, no order
 * and no request of any kind: the free edition needs nothing issued to use it,
 * so this file works when the shop is down. That is the point of it -- a broken
 * checkout must not take the free download with it.
 *
 * Where the links live
 * --------------------
 * Here, which is a departure. The paid build's links are read from
 * /public-config so that publishing a build is a server change rather than a
 * site deploy. That reasoning does not carry over: a free download is not
 * issued per visitor and carries no entitlement, so there is nothing for the
 * server to decide, and asking it would mean the free download failing whenever
 * the server did. The prices and the keys stay on the server because those are
 * per-order facts; these two URLs are not.
 *
 * If the archives are ever renamed or moved, these two strings are the whole of
 * the change on the site.
 *
 * Depends on checkout.js, which is loaded before this file on the products page:
 * the platform picker, the detection and the label are shared, so there is one
 * definition of "which system is this visitor on" rather than two that could
 * disagree.
 */

/**
 * The published free builds, by platform id.
 *
 * Both are a single archive whose root folder is Gesleap-Freemium; the paths
 * the popup quotes are relative to that, and are listed in key-dialog.js.
 */
const FREEMIUM_DOWNLOADS = {
  linux: "https://pub-50b544353f914584bfcea0ea99d78da1.r2.dev/Gesleap-Freemium-linux-x64.zip",
  windows: "https://pub-50b544353f914584bfcea0ea99d78da1.r2.dev/Gesleap-Freemium-windows-x64.zip"
};

/**
 * What the free edition does, said plainly.
 *
 * This is the one place a visitor is told the trial is limited, and it is
 * deliberately ahead of the download rather than discovered forty seconds in:
 * an app that stops responding to the rest of the gestures reads as broken
 * unless someone has already said which gestures it answers to.
 *
 * The gestures are named by the fingers raised, not by what they do, because
 * that is what the visitor has to do. The action is named too, because a finger
 * count on its own means nothing.
 */
const FREEMIUM_INSTRUCTIONS =
  "This free edition supports single click (index finger raised) and exit (index and little finger raised). " +
  "Each run lasts 60 seconds, then the app closes by itself. Start it again whenever you like.";

/**
 * A status line under the download button.
 *
 * The message only ever appears when something is wrong, and the element stays
 * hidden otherwise so the column does not reserve space for text that is not
 * there.
 */
function setFreemiumStatus(root, message, state = "info") {
  const status = root.querySelector("[data-freemium-status]");
  if (!status) {
    return;
  }

  status.textContent = message || "";
  status.dataset.state = state;
  status.hidden = !message;
}

/** Open the download popup for one platform. */
function showFreemiumDownload(root, platform) {
  const url = FREEMIUM_DOWNLOADS[platform];

  // Only reachable if a platform is added to the picker without a link to go
  // with it. Said here rather than silently doing nothing, because a button that
  // does nothing on click is read as a broken page rather than a missing build.
  if (!url) {
    setFreemiumStatus(
      root,
      `There is no free build for ${platformLabel(platform)} yet.`,
      "error"
    );
    return;
  }

  setFreemiumStatus(root, "");

  const dialog = createKeyDialog({
    // No licenseKey, so the popup drops the key row entirely -- the free
    // edition has no key, and an empty slot for one would suggest something
    // should have been sent.
    heading: "Gesleap - Free Edition",
    note: "No licence key is needed. Unzip the download and run the app.",
    edition: "freemium",
    platform,
    downloadUrl: url,
    instructions: FREEMIUM_INSTRUCTIONS
  });

  document.body.append(dialog.overlay);
  dialog.focus();
}

/** Wire the Free edition's picker and download button, if the page has them. */
function initFreemiumDownload() {
  const root = document.querySelector("[data-freemium]");
  if (!root) {
    return;
  }

  // Shared with the paid row. Scoped to this root, so the two pickers stay
  // independent, and the radios carry different names so selecting in one
  // cannot clear the other.
  initPlatformPicker(root);

  const button = root.querySelector("[data-freemium-button]");
  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    // Read at click time rather than at load: the visitor may have changed the
    // picker since the page opened, and the download must match what is on
    // screen when they press the button.
    showFreemiumDownload(root, currentPlatform(root));
  });
}

initFreemiumDownload();

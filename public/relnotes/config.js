// Checkout and install URLs are not set. Do not print these tokens on the page.
const RELNOTES_CONFIG = Object.freeze({
  STRIPE_LINK_REPO: "STRIPE_LINK_REPO",
  STRIPE_LINK_TEAM: "STRIPE_LINK_TEAM",
  INSTALL_URL: "INSTALL_URL",
  SUPPORT_EMAIL: "hello@nixonmade.com",
});

function relnotesIsHttpsUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
}

function relnotesIsEmail(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

function applyRelnotesConfig() {
  document.querySelectorAll("[data-config]").forEach((el) => {
    const key = el.getAttribute("data-config");
    if (!Object.prototype.hasOwnProperty.call(RELNOTES_CONFIG, key)) return;
    const value = RELNOTES_CONFIG[key];
    if (key === "SUPPORT_EMAIL") {
      if (!relnotesIsEmail(value)) return;
      el.setAttribute("href", "mailto:" + value);
      el.textContent = value;
      return;
    }
    if (!relnotesIsHttpsUrl(value)) return;
    el.setAttribute("href", value);
    el.setAttribute("rel", "noopener noreferrer");
    if (el.hasAttribute("data-config-text")) el.textContent = value;
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyRelnotesConfig);
  } else {
    applyRelnotesConfig();
  }
}

// Edit relnotes links here only. Values are placeholders, not live URLs.
const RELNOTES_CONFIG = Object.freeze({
  STRIPE_LINK_REPO: "STRIPE_LINK_REPO",
  STRIPE_LINK_TEAM: "STRIPE_LINK_TEAM",
  INSTALL_URL: "INSTALL_URL",
  SUPPORT_EMAIL: "hello@nixonmade.com",
});

function applyRelnotesConfig() {
  document.querySelectorAll("[data-config]").forEach((el) => {
    const key = el.getAttribute("data-config");
    if (!Object.prototype.hasOwnProperty.call(RELNOTES_CONFIG, key)) return;
    const value = RELNOTES_CONFIG[key];
    if (typeof value !== "string" || value.length === 0) return;
    if (key === "SUPPORT_EMAIL") {
      el.setAttribute("href", "mailto:" + value);
      el.textContent = value;
      return;
    }
    el.setAttribute("href", value);
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

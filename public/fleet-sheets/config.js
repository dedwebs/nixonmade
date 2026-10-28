/**
 * Fleet Sheets checkout and support.
 * STRIPE_LINK and SUPPORT_EMAIL live only in this object.
 */
const FLEET_SHEETS = Object.freeze({
  STRIPE_LINK: "https://buy.stripe.com/aFabIVchb29k47r9FneQM02",
  SUPPORT_EMAIL: "hello@nixonmade.com",
});

function fleetSheetsIsHttpsUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.length > 0 &&
    url.username === "" &&
    url.password === ""
  );
}

function fleetSheetsIsEmail(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

function fleetSheetsApply() {
  document.querySelectorAll("[data-fleet]").forEach((el) => {
    const key = el.getAttribute("data-fleet");
    if (!Object.prototype.hasOwnProperty.call(FLEET_SHEETS, key)) return;
    const value = FLEET_SHEETS[key];
    if (key === "SUPPORT_EMAIL") {
      if (!fleetSheetsIsEmail(value)) {
        el.removeAttribute("href");
        el.setAttribute("aria-disabled", "true");
        return;
      }
      el.textContent = value;
      el.setAttribute("href", "mailto:" + value);
      el.removeAttribute("aria-disabled");
      return;
    }
    if (key !== "STRIPE_LINK") return;
    if (!fleetSheetsIsHttpsUrl(value)) {
      el.removeAttribute("href");
      el.setAttribute("aria-disabled", "true");
      return;
    }
    el.setAttribute("href", value);
    el.setAttribute("rel", "noopener noreferrer");
    el.removeAttribute("aria-disabled");
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a[data-fleet][aria-disabled='true']");
  if (!link) return;
  event.preventDefault();
});

fleetSheetsApply();

/**
 * Ship Kit links and support contact.
 * Checkout is off in production until the owner opens it.
 * STRIPE_LINK_KIT is the live Payment Link. Do not bind it to a button.
 * STRIPE_LINK_DFY and INTAKE_URL are unset. The done-for-you service has no buy link.
 */
const SHIP_KIT = Object.freeze({
  STRIPE_LINK_KIT: "https://buy.stripe.com/28EcMZ4OJbJUdI1eZHeQM01",
  STRIPE_LINK_DFY: "STRIPE_LINK_DFY",
  INTAKE_URL: "INTAKE_URL",
  SUPPORT_EMAIL: "hello@nixonmade.com",
  CHECKOUT_ENABLED: false,
});

function shipKitIsHttpsUrl(value) {
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

function shipKitIsEmail(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

function shipKitApply() {
  document.querySelectorAll("[data-ship]").forEach((el) => {
    const key = el.getAttribute("data-ship");
    if (!Object.prototype.hasOwnProperty.call(SHIP_KIT, key)) return;
    const value = SHIP_KIT[key];
    if (key === "SUPPORT_EMAIL") {
      if (!shipKitIsEmail(value)) return;
      el.setAttribute("href", "mailto:" + value);
      el.removeAttribute("aria-disabled");
      return;
    }
    if (key === "STRIPE_LINK_KIT" || key === "STRIPE_LINK_DFY" || key === "INTAKE_URL") {
      if (SHIP_KIT.CHECKOUT_ENABLED !== true) return;
    }
    if (!shipKitIsHttpsUrl(value)) return;
    el.setAttribute("href", value);
    el.setAttribute("rel", "noopener noreferrer");
    el.removeAttribute("aria-disabled");
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a[data-ship][aria-disabled='true']");
  if (!link) return;
  event.preventDefault();
});

shipKitApply();

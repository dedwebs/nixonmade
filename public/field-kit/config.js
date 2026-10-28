/**
 * Field Kit price, checkout, and support.
 * This object is the only place these placeholders live.
 * STRIPE_LINK_FIELD_KIT is a token, not a payment URL.
 * Nothing here is sent to a third party.
 */
const FIELD_KIT = Object.freeze({
  KIT_PRICE: "[$19-29 suggested, TBD]",
  STRIPE_LINK_FIELD_KIT: "STRIPE_LINK_FIELD_KIT",
  SUPPORT_EMAIL: "hello@nixonmade.com",
});

function fieldKitIsHttpsUrl(value) {
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

function fieldKitIsEmail(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

function fieldKitApply() {
  const price = FIELD_KIT.KIT_PRICE;
  const titleEl = document.querySelector("title[data-field-title]");
  if (titleEl && typeof price === "string") {
    const title = "NixonMade Mac Admin Field Kit, " + price + ".";
    titleEl.textContent = title;
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);
  }

  document.querySelectorAll("[data-field-text='KIT_PRICE']").forEach((el) => {
    if (typeof price === "string") el.textContent = price;
  });

  document.querySelectorAll("[data-field]").forEach((el) => {
    const key = el.getAttribute("data-field");
    if (!Object.prototype.hasOwnProperty.call(FIELD_KIT, key)) return;
    const value = FIELD_KIT[key];
    if (key === "SUPPORT_EMAIL") {
      if (!fieldKitIsEmail(value)) {
        el.removeAttribute("href");
        el.setAttribute("aria-disabled", "true");
        return;
      }
      el.textContent = value;
      el.setAttribute("href", "mailto:" + value);
      el.removeAttribute("aria-disabled");
      return;
    }
    if (key !== "STRIPE_LINK_FIELD_KIT") return;
    if (!fieldKitIsHttpsUrl(value)) {
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
  const link = target.closest("a[data-field][aria-disabled='true']");
  if (!link) return;
  event.preventDefault();
});

fieldKitApply();

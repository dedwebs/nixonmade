/* Fleet Health Check placeholders.
   This object is the only place these values live.
   Leave a string empty until it is real.
   Do not put live payment links, secrets, or a production form endpoint here. */
const FLEET_HEALTH_CHECK = {
  STRIPE_LINK_STANDARD: "",
  STRIPE_LINK_PRO: "",
  FORM_ENDPOINT: "",
  FIELD_KIT_URL: "",
  CONTACT_EMAIL: "hello@nixonmade.com",
  POLICY_URL: "/fleet-health-check/data-handling/",
  TERMS_URL: "",
  LITE_PRICE: "[$79 suggested, TBD]",
};

Object.freeze(FLEET_HEALTH_CHECK);

(function () {
  if (typeof document === "undefined") return;

  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function httpUrl(value) {
    var raw = clean(value);
    if (!raw) return "";
    if (/^javascript:/i.test(raw) || /^data:/i.test(raw) || raw.indexOf("\\") !== -1) {
      return "";
    }
    if (raw.charAt(0) === "/" && raw.charAt(1) !== "/") {
      if (/\s/.test(raw)) return "";
      return raw;
    }
    try {
      var url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      if (url.username || url.password) return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function absoluteHttpUrl(value) {
    var raw = clean(value);
    if (!raw || raw.charAt(0) === "/") return "";
    return httpUrl(raw);
  }

  function emailAddress(value) {
    var raw = clean(value);
    if (!raw || raw.length > 254) return "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return "";
    return raw;
  }

  function each(selector, fn) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i += 1) fn(nodes[i]);
  }

  function applyLink(key) {
    var href = httpUrl(FLEET_HEALTH_CHECK[key]);
    each('[data-config-href="' + key + '"]', function (el) {
      if (!href) {
        el.removeAttribute("href");
        el.setAttribute("aria-disabled", "true");
        el.tabIndex = 0;
        return;
      }
      el.href = href;
      el.removeAttribute("aria-disabled");
      el.removeAttribute("tabindex");
      if (/^https?:/i.test(href)) {
        el.rel = "nofollow noopener noreferrer";
        el.referrerPolicy = "no-referrer";
      }
    });
    each('[data-config-placeholder="' + key + '"]', function (el) {
      if (href) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.textContent = "[" + key + "]";
    });
  }

  function applyEmail(key) {
    var email = emailAddress(FLEET_HEALTH_CHECK[key]);
    each('[data-config-email="' + key + '"]', function (el) {
      if (!email) {
        el.textContent = "[" + key + "]";
        el.removeAttribute("href");
        return;
      }
      el.textContent = email;
      el.href = "mailto:" + encodeURIComponent(email);
    });
  }

  function applyText(key) {
    var value = clean(FLEET_HEALTH_CHECK[key]);
    each('[data-config-text="' + key + '"]', function (el) {
      el.textContent = value || "[" + key + "]";
    });
  }

  function applyPayment(key) {
    var href = httpUrl(FLEET_HEALTH_CHECK[key]);
    each('[data-config-payment="' + key + '"]', function (el) {
      if (!href) return;
      el.href = href;
      el.rel = "nofollow noopener noreferrer";
      el.referrerPolicy = "no-referrer";
    });
    each('[data-config-stripe="' + key + '"]', function (el) {
      if (href) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.textContent = "[" + key + "]";
    });
  }

  ["FIELD_KIT_URL", "POLICY_URL", "TERMS_URL"].forEach(applyLink);
  applyEmail("CONTACT_EMAIL");
  applyText("LITE_PRICE");
  applyPayment("STRIPE_LINK_STANDARD");

  each("[data-config-href]", function (el) {
    el.addEventListener("click", function (event) {
      if (!el.getAttribute("href")) event.preventDefault();
    });
  });

  var form = document.querySelector("[data-intake-form]");
  if (!form) return;

  var endpoint = absoluteHttpUrl(FLEET_HEALTH_CHECK.FORM_ENDPOINT);
  var notice = document.querySelector("[data-preview-notice]");
  var submitButton = form.querySelector("[data-intake-submit]");

  if (endpoint) {
    form.onsubmit = null;
    form.removeAttribute("onsubmit");
    form.action = endpoint;
    form.method = "post";
    if (notice) notice.hidden = true;
    if (submitButton) submitButton.removeAttribute("aria-describedby");
    return;
  }

  if (notice) notice.hidden = false;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!notice) return;
    notice.hidden = false;
    notice.focus();
  });
})();

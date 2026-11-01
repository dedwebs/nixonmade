/* Fail closed. A buy button stays inert unless this page is the production
   site. Ship Kit has no data-checkout control, so it stays off everywhere. */
(function () {
  var host = "";
  try {
    host = String(location.hostname || "");
  } catch (error) {
    host = "";
  }

  function isProduction(hostname) {
    return hostname === "nixonmade.com" || hostname === "www.nixonmade.com";
  }

  function isStripeUrl(value) {
    if (typeof value !== "string" || value.length === 0) return false;
    var url;
    try {
      url = new URL(value);
    } catch (error) {
      return false;
    }
    return (
      url.protocol === "https:" &&
      (url.hostname === "buy.stripe.com" || url.hostname === "checkout.stripe.com") &&
      url.username === "" &&
      url.password === ""
    );
  }

  function disable(el) {
    el.removeAttribute("href");
    el.setAttribute("aria-disabled", "true");
  }

  function enable(el, url) {
    el.setAttribute("href", url);
    el.setAttribute("rel", "noopener noreferrer");
    el.removeAttribute("aria-disabled");
  }

  var production = isProduction(host);

  document.querySelectorAll("[data-checkout]").forEach(function (el) {
    var url = el.getAttribute("data-checkout-url") || "";
    if (production && isStripeUrl(url)) enable(el, url);
    else disable(el);
  });

  document.querySelectorAll("a[href], button[href]").forEach(function (el) {
    var href = el.getAttribute("href") || "";
    if (href.indexOf("buy.stripe.com") === -1 && href.indexOf("checkout.stripe.com") === -1) {
      return;
    }
    var allowed =
      production &&
      el.hasAttribute("data-checkout") &&
      isStripeUrl(el.getAttribute("data-checkout-url")) &&
      href === el.getAttribute("data-checkout-url");
    if (!allowed) disable(el);
  });

  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var link = target.closest("a, button");
      if (!link) return;
      var inert = link.getAttribute("aria-disabled") === "true";
      var checkoutWithoutHref = link.hasAttribute("data-checkout") && !link.getAttribute("href");
      if (inert || checkoutWithoutHref) {
        event.preventDefault();
      }
    },
    true
  );
})();

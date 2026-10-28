/* Disable Stripe checkout on Cloudflare preview hosts.
   Production hostnames are left unchanged. */
(function () {
  var host = "";
  try {
    host = String(location.hostname || "");
  } catch (error) {
    return;
  }
  if (!host.endsWith("workers.dev")) return;

  function isBuyLink(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute("data-checkout")) return true;
    var href = el.getAttribute("href") || "";
    return href.indexOf("buy.stripe.com") !== -1 || href.indexOf("checkout.stripe.com") !== -1;
  }

  function disable(el) {
    el.removeAttribute("href");
    el.setAttribute("aria-disabled", "true");
    el.setAttribute("tabindex", "-1");
    el.textContent = "Checkout disabled on preview";
  }

  function scan(root) {
    var nodes = (root || document).querySelectorAll("a, button");
    for (var i = 0; i < nodes.length; i++) {
      if (isBuyLink(nodes[i])) disable(nodes[i]);
    }
  }

  scan(document);
  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var link = target.closest("a, button");
      if (!isBuyLink(link) && !(link && link.getAttribute("aria-disabled") === "true" && link.textContent === "Checkout disabled on preview")) {
        return;
      }
      event.preventDefault();
    },
    true
  );
})();

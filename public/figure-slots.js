/* Show a product figure only when its file is actually on the server.
   Missing screenshots are removed so the page never shows a broken box. */
(function () {
  var slots = document.querySelectorAll(".figure-slot img[data-src]");
  for (var i = 0; i < slots.length; i++) {
    (function (img) {
      var figure = img.closest(".figure-slot");
      var probe = new Image();
      probe.onload = function () {
        img.src = img.getAttribute("data-src");
        img.removeAttribute("hidden");
        if (figure) figure.removeAttribute("hidden");
      };
      probe.onerror = function () {
        if (figure && figure.parentNode) figure.parentNode.removeChild(figure);
      };
      probe.src = img.getAttribute("data-src");
    })(slots[i]);
  }
})();

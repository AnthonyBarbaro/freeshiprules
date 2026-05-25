(function () {
  if (window.FreeShipRulesProgressLoaded) return;
  window.FreeShipRulesProgressLoaded = true;

  var CART_PATH_PATTERN = /\/cart(?:\/(?:add|change|update|clear))?\.js(?:\?|$)/;
  var refreshTimer = null;

  function money(cents) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: window.Shopify?.currency?.active || "USD",
      }).format(cents / 100);
    } catch {
      return "$" + (cents / 100).toFixed(2);
    }
  }

  function booleanValue(value) {
    return value === "true" || value === true;
  }

  function hasDiscountCodeSignal() {
    var search = new URLSearchParams(window.location.search);
    return Boolean(
      search.get("discount") ||
        search.get("discount_code") ||
        window.location.pathname.indexOf("/discount/") !== -1,
    );
  }

  function message(template, amountCents) {
    return String(template || "")
      .replace("[amount]", money(amountCents))
      .replace("{{ amount }}", money(amountCents));
  }

  function cartWeightPounds(cart) {
    return Number(cart.total_weight || 0) / 453.59237;
  }

  function updateProgress(root, cart) {
    var goalCents = Number(root.dataset.goalCents || 0);
    var subtotal = Number(cart.items_subtotal_price || cart.total_price || 0);
    var weightEnabled = booleanValue(root.dataset.weightEnabled);
    var maxWeightPounds = Number(root.dataset.maxWeightPounds || 0);
    var quantityEnabled = booleanValue(root.dataset.quantityEnabled);
    var maxQuantity = Number(root.dataset.maxQuantity || 0);
    var hideWhenQualified = booleanValue(root.dataset.hideWhenQualified);
    var showEmptyCart = booleanValue(root.dataset.showEmptyCart);
    var fill = root.querySelector(".freeship-rules-progress__fill");
    var track = root.querySelector(".freeship-rules-progress__track");
    var output = root.querySelector(".freeship-rules-progress__message");
    var progress = goalCents > 0 ? Math.min(100, (subtotal / goalCents) * 100) : 100;
    var qualified = goalCents <= 0 || subtotal >= goalCents;

    if (!showEmptyCart && Number(cart.item_count || 0) === 0) {
      root.hidden = true;
      return;
    }

    if (hideWhenQualified && qualified) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    root.classList.toggle("freeship-rules-progress--qualified", qualified);

    if (fill) fill.style.width = progress + "%";
    if (track) track.setAttribute("aria-valuenow", String(Math.round(progress)));
    if (!output) return;

    if (booleanValue(root.dataset.checkDiscountCode) && hasDiscountCodeSignal()) {
      output.textContent = root.dataset.codeMessage || "";
      return;
    }

    if (
      weightEnabled &&
      maxWeightPounds > 0 &&
      cartWeightPounds(cart) > maxWeightPounds
    ) {
      output.textContent = root.dataset.weightMessage || "";
      return;
    }

    if (quantityEnabled && maxQuantity > 0 && Number(cart.item_count || 0) > maxQuantity) {
      output.textContent = root.dataset.quantityMessage || "";
      return;
    }

    if (qualified) {
      output.textContent = root.dataset.qualifiedMessage || "";
      return;
    }

    output.textContent = message(root.dataset.awayTemplate, goalCents - subtotal);
  }

  function roots() {
    return Array.prototype.slice.call(
      document.querySelectorAll("[data-freeship-progress]"),
    );
  }

  function refresh() {
    var blocks = roots();
    if (blocks.length === 0) return;

    fetch("/cart.js", { credentials: "same-origin" })
      .then(function (response) {
        return response.json();
      })
      .then(function (cart) {
        blocks.forEach(function (root) {
          updateProgress(root, cart);
        });
      })
      .catch(function () {
        blocks.forEach(function (root) {
          root.hidden = true;
        });
      });
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 250);
  }

  function cartUrl(value) {
    try {
      return new URL(String(value), window.location.origin).pathname + "?";
    } catch {
      return String(value || "");
    }
  }

  function watchCartFetches() {
    if (!window.fetch) return;
    var originalFetch = window.fetch;

    window.fetch = function () {
      var request = arguments[0];
      var url =
        typeof request === "string"
          ? request
          : request && request.url
            ? request.url
            : "";

      return originalFetch.apply(this, arguments).then(function (response) {
        if (CART_PATH_PATTERN.test(cartUrl(url))) scheduleRefresh();
        return response;
      });
    };
  }

  function start() {
    refresh();
    watchCartFetches();
    document.addEventListener("cart:updated", scheduleRefresh);
    document.addEventListener("cart:refresh", scheduleRefresh);
    document.addEventListener("ajaxCart:updated", scheduleRefresh);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

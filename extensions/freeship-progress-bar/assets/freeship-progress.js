(function () {
  if (window.FreeShipRulesProgressLoaded) return;
  window.FreeShipRulesProgressLoaded = true;

  var CART_PATH_PATTERN = /\/cart(?:\/(?:add|change|update|clear))?\.js(?:\?|$)/;
  var CART_PAGE_PATTERN = /\/cart\/?$/;
  var refreshTimer = null;
  var configPromise = null;

  function booleanValue(value) {
    return value === "true" || value === true;
  }

  function money(cents, currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode || window.Shopify?.currency?.active || "USD",
      }).format(cents / 100);
    } catch {
      return "$" + (cents / 100).toFixed(2);
    }
  }

  function appProxyRoot() {
    var shopifyRoot = window.Shopify?.routes?.root || "/";
    return shopifyRoot.replace(/\/?$/, "/") + "apps/freeship-rules/progress-config";
  }

  function configUrl(root) {
    return root.dataset.configUrl || appProxyRoot();
  }

  function fetchConfig(root) {
    if (configPromise) return configPromise;

    configPromise = fetch(configUrl(root), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Config unavailable");
        return response.json();
      })
      .catch(function () {
        return fallbackConfig(root);
      });

    return configPromise;
  }

  function fallbackConfig(root) {
    return {
      enabled: true,
      heading: root.dataset.heading || "Free shipping",
      goalCents: Number(root.dataset.goalCents || 40000),
      currencyCode: window.Shopify?.currency?.active || "USD",
      checkDiscountCode: booleanValue(root.dataset.checkDiscountCode),
      weightEnabled: booleanValue(root.dataset.weightEnabled),
      maxWeightPounds: Number(root.dataset.maxWeightPounds || 30),
      quantityEnabled: booleanValue(root.dataset.quantityEnabled),
      maxQuantity: Number(root.dataset.maxQuantity || 6),
      showEmptyCart: root.dataset.showEmptyCart !== "false",
      hideWhenQualified: booleanValue(root.dataset.hideWhenQualified),
      messages: {
        awayTemplate:
          root.dataset.awayTemplate ||
          "You are [amount] away from free shipping",
        qualified:
          root.dataset.qualifiedMessage || "You qualify for free shipping",
        discountCode:
          root.dataset.codeMessage ||
          "Free shipping cannot be combined with discount codes",
        weight:
          root.dataset.weightMessage ||
          "Free shipping available under [weight] lb",
        quantity:
          root.dataset.quantityMessage ||
          "Free shipping available up to [quantity] items",
      },
    };
  }

  function hasDiscountCodeSignal() {
    var search = new URLSearchParams(window.location.search);
    return Boolean(
      search.get("discount") ||
        search.get("discount_code") ||
        window.location.pathname.indexOf("/discount/") !== -1,
    );
  }

  function formatNumber(value) {
    var number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function message(template, amountCents, config) {
    return String(template || "")
      .replaceAll("[amount]", money(amountCents, config.currencyCode))
      .replaceAll("{{ amount }}", money(amountCents, config.currencyCode))
      .replaceAll("[weight]", formatNumber(config.maxWeightPounds))
      .replaceAll("[quantity]", String(config.maxQuantity || 0));
  }

  function cartWeightPounds(cart) {
    return Number(cart.total_weight || 0) / 453.59237;
  }

  function isCartPage() {
    return CART_PAGE_PATTERN.test(window.location.pathname);
  }

  function cartPlacementTarget() {
    return (
      document.querySelector("cart-footer") ||
      document.querySelector(".cart__footer") ||
      document.querySelector("[data-cart-footer]") ||
      document.querySelector('[id*="cart-footer"]') ||
      document.querySelector('form[action$="/cart"]') ||
      document.querySelector('form[action*="/cart"]') ||
      document.querySelector("main")
    );
  }

  function applyPlacement(root) {
    var placement = root.dataset.placement || "inline";
    var compact = root.dataset.size !== "standard";

    root.classList.toggle("freeship-rules-progress--compact", compact);

    if (placement !== "cart-page") return true;
    if (!isCartPage()) {
      root.hidden = true;
      return false;
    }

    var target = cartPlacementTarget();
    if (target && !target.contains(root)) {
      target.insertBefore(root, target.firstChild);
    }

    return true;
  }

  function applyConfig(root, config) {
    var heading = root.querySelector(".freeship-rules-progress__heading");
    if (heading) {
      heading.textContent = config.heading || "";
      heading.hidden = !config.heading;
    }
  }

  function updateProgress(root, cart, config) {
    if (!applyPlacement(root)) return;

    if (!config.enabled) {
      root.hidden = true;
      return;
    }

    applyConfig(root, config);

    var goalCents = Number(config.goalCents || 0);
    var subtotal = Number(cart.items_subtotal_price || cart.total_price || 0);
    var weightEnabled = Boolean(config.weightEnabled);
    var maxWeightPounds = Number(config.maxWeightPounds || 0);
    var quantityEnabled = Boolean(config.quantityEnabled);
    var maxQuantity = Number(config.maxQuantity || 0);
    var hideWhenQualified = Boolean(config.hideWhenQualified);
    var showEmptyCart = config.showEmptyCart !== false;
    var fill = root.querySelector(".freeship-rules-progress__fill");
    var track = root.querySelector(".freeship-rules-progress__track");
    var output = root.querySelector(".freeship-rules-progress__message");
    var progress = goalCents > 0 ? Math.min(100, (subtotal / goalCents) * 100) : 100;
    var qualified = goalCents <= 0 || subtotal >= goalCents;
    var messages = config.messages || {};

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

    if (config.checkDiscountCode && hasDiscountCodeSignal()) {
      output.textContent = message(messages.discountCode, 0, config);
      return;
    }

    if (
      weightEnabled &&
      maxWeightPounds > 0 &&
      cartWeightPounds(cart) > maxWeightPounds
    ) {
      output.textContent = message(messages.weight, 0, config);
      return;
    }

    if (quantityEnabled && maxQuantity > 0 && Number(cart.item_count || 0) > maxQuantity) {
      output.textContent = message(messages.quantity, 0, config);
      return;
    }

    if (qualified) {
      output.textContent = message(messages.qualified, 0, config);
      return;
    }

    output.textContent = message(messages.awayTemplate, goalCents - subtotal, config);
  }

  function roots() {
    return Array.prototype.slice.call(
      document.querySelectorAll("[data-freeship-progress]"),
    );
  }

  function refresh() {
    var blocks = roots();
    if (blocks.length === 0) return;

    Promise.all([
      fetchConfig(blocks[0]),
      fetch("/cart.js", { credentials: "same-origin" }).then(function (response) {
        return response.json();
      }),
    ])
      .then(function (results) {
        blocks.forEach(function (root) {
          updateProgress(root, results[1], results[0]);
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
    roots().forEach(applyPlacement);
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

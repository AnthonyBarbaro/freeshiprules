(function () {
  if (window.FreeShipRulesProgressLoaded) return;
  window.FreeShipRulesProgressLoaded = true;

  var CART_PATH_PATTERN =
    /\/cart(?:\/(?:add|change|update|clear))?\.js(?:\?|$)/;
  var CART_PAGE_PATTERN = /\/cart\/?$/;
  var refreshTimer = null;
  var refreshSequence = 0;
  var configPromise = null;
  var progressRoots = [];
  var nativeFetch = null;

  function booleanValue(value) {
    return value === "true" || value === true;
  }

  function settingEnabled(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return booleanValue(value);
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
    return (
      shopifyRoot.replace(/\/?$/, "/") + "apps/freeship-rules/progress-config"
    );
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
      protectionVariantIds: [],
      productTargetingMode: "ALL",
      eligibleProductHandles: [],
      eligibleProductTypes: [],
      eligibleProductVendors: [],
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

  function isProtectionItem(item, config) {
    var ids = (config.protectionVariantIds || []).map(String);
    var properties = item.properties || {};

    return (
      ids.indexOf(String(item.variant_id)) !== -1 ||
      properties._freeship_shipping_protection === "true"
    );
  }

  function protectionItems(cart, config) {
    return (cart.items || []).filter(function (item) {
      return isProtectionItem(item, config);
    });
  }

  function normalized(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function matchesList(value, list) {
    var normalizedValue = normalized(value);
    return (
      Boolean(normalizedValue) &&
      (list || []).some(function (candidate) {
        return normalized(candidate) === normalizedValue;
      })
    );
  }

  function hasProductTargets(config) {
    return (
      (config.eligibleProductHandles || []).length > 0 ||
      (config.eligibleProductTypes || []).length > 0 ||
      (config.eligibleProductVendors || []).length > 0
    );
  }

  function isTargetedProduct(item, config) {
    return (
      matchesList(item.handle, config.eligibleProductHandles) ||
      matchesList(item.product_type, config.eligibleProductTypes) ||
      matchesList(item.vendor, config.eligibleProductVendors)
    );
  }

  function shippableItems(cart, config) {
    return (cart.items || []).filter(function (item) {
      return !isProtectionItem(item, config);
    });
  }

  function productTargetingState(cart, config) {
    var mode = config.productTargetingMode || "ALL";
    var items = shippableItems(cart, config);
    var matchingItems = items.filter(function (item) {
      return isTargetedProduct(item, config);
    });

    if (mode === "ALL") {
      return { countedItems: items, eligible: true, selectedOnly: false };
    }

    if (!hasProductTargets(config)) {
      return { countedItems: [], eligible: false, selectedOnly: true };
    }

    if (mode === "ANY_SELECTED") {
      return {
        countedItems: items,
        eligible: matchingItems.length > 0,
        selectedOnly: false,
      };
    }

    if (mode === "ALL_SELECTED") {
      return {
        countedItems: matchingItems,
        eligible:
          items.length > 0 &&
          matchingItems.length > 0 &&
          matchingItems.length === items.length,
        selectedOnly: true,
      };
    }

    return {
      countedItems: matchingItems,
      eligible: matchingItems.length > 0,
      selectedOnly: true,
    };
  }

  function cartSubtotalCents(cart, config) {
    var targeting = productTargetingState(cart, config);

    if (targeting.selectedOnly) {
      return targeting.countedItems.reduce(function (sum, item) {
        return sum + Number(item.final_line_price ?? item.line_price ?? 0);
      }, 0);
    }

    var subtotal = Number(cart.items_subtotal_price || cart.total_price || 0);
    var protectionTotal = protectionItems(cart, config).reduce(function (
      sum,
      item,
    ) {
      return sum + Number(item.final_line_price ?? item.line_price ?? 0);
    }, 0);

    return Math.max(0, subtotal - protectionTotal);
  }

  function cartQuantity(cart, config) {
    return productTargetingState(cart, config).countedItems.reduce(function (
      sum,
      item,
    ) {
      return sum + Number(item.quantity || 0);
    }, 0);
  }

  function cartWeightPounds(cart, config) {
    var grams = productTargetingState(cart, config).countedItems.reduce(
      function (sum, item) {
        return sum + Number(item.grams || 0) * Number(item.quantity || 0);
      },
      0,
    );

    return grams / 453.59237;
  }

  function isCartPage() {
    return CART_PAGE_PATTERN.test(window.location.pathname);
  }

  function cartSummaryTarget() {
    var selectors = [
      "[data-fsr-cart-summary-target]",
      "#main-cart-footer .cart__blocks",
      "cart-footer .cart__blocks",
      ".cart__footer .cart__blocks",
      "[id*='cart-footer'] .cart__blocks",
      ".cart-drawer__footer",
      "#CartDrawer .drawer__footer",
      "#main-cart-footer",
      "cart-footer",
      ".cart__footer",
      "[data-cart-footer]",
      "[id*='cart-footer']",
    ];

    for (var index = 0; index < selectors.length; index += 1) {
      var target = document.querySelector(selectors[index]);
      if (target) return target;
    }

    var checkout = document.querySelector(
      'button[name="checkout"], input[name="checkout"], .cart__checkout-button, a[href$="/checkout"]',
    );
    if (!checkout) return null;

    var ctas = checkout.closest(".cart__ctas");
    if (ctas && ctas.parentElement) return ctas.parentElement;

    return checkout.closest(
      ".cart__blocks, .cart__footer, .cart-drawer__footer, aside, footer, section, form, div",
    );
  }

  function insertAfter(node, anchor) {
    if (!anchor || !anchor.parentElement) return false;
    anchor.parentElement.insertBefore(node, anchor.nextSibling);
    return true;
  }

  function customPlacementTarget(root) {
    var selector = String(root.dataset.customTarget || "").trim();
    if (!selector) return null;

    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function moveToCustomTarget(root) {
    var target = customPlacementTarget(root);
    if (!target) return false;

    var position = root.dataset.customPosition || "inside_end";
    root.classList.add("freeship-rules-progress--custom-target");

    if (position === "before" && target.parentElement) {
      target.parentElement.insertBefore(root, target);
      return true;
    }

    if (position === "after" && insertAfter(root, target)) {
      return true;
    }

    if (position === "inside_start") {
      if (target.firstChild !== root) target.insertBefore(root, target.firstChild);
      return true;
    }

    if (!target.contains(root)) target.appendChild(root);
    return true;
  }

  function cartSummaryStack(target, placement) {
    var stackAttribute =
      placement === "cart-after-checkout"
        ? "data-fsr-cart-summary-stack-after"
        : "data-fsr-cart-summary-stack";
    var existing = document.querySelector("[" + stackAttribute + "]");
    if (existing) return existing;

    target = target || cartSummaryTarget();
    if (!target) return null;
    if (target.matches && target.matches(".cart__ctas") && target.parentElement) {
      target = target.parentElement;
    }

    var stack = document.createElement("div");
    stack.className = "freeship-rules-cart-stack";
    stack.setAttribute(stackAttribute, "true");

    var checkoutArea = target.querySelector(
      '.cart__ctas, button[name="checkout"], input[name="checkout"], .cart__checkout-button, a[href$="/checkout"]',
    );
    var anchor = checkoutArea?.closest?.(".cart__ctas") || checkoutArea;

    if (anchor && anchor.parentElement === target) {
      if (placement === "cart-after-checkout") {
        insertAfter(stack, anchor);
      } else {
        target.insertBefore(stack, anchor);
      }
    } else {
      target.insertBefore(stack, target.firstChild);
    }

    return stack;
  }

  function stackOrder(root) {
    return root.dataset.fsrStackItem === "protection" ? 1 : 2;
  }

  function sortSummaryStack(stack) {
    Array.prototype.slice
      .call(stack.children)
      .sort(function (a, b) {
        return stackOrder(a) - stackOrder(b);
      })
      .forEach(function (child) {
        stack.appendChild(child);
      });
  }

  function moveToSummaryStack(root, target, placement) {
    var stack = cartSummaryStack(target, placement);
    if (!stack) return false;

    root.dataset.fsrStackItem = "progress";
    root.classList.add("freeship-rules-stack-item");
    if (!stack.contains(root)) stack.appendChild(root);
    sortSummaryStack(stack);
    return true;
  }

  function cartPlacementTarget() {
    return (
      cartSummaryTarget() ||
      document.querySelector('form[action$="/cart"]') ||
      document.querySelector('form[action*="/cart"]') ||
      document.querySelector("main")
    );
  }

  function applyPlacement(root) {
    var placement = root.dataset.placement || "inline";
    var compact = root.dataset.size !== "standard";
    var floating =
      placement === "fixed-right" || placement === "fixed-bottom-right";

    root.classList.toggle("freeship-rules-progress--compact", compact);
    root.classList.toggle("freeship-rules-progress--cart-top", placement === "cart-top");
    root.classList.toggle("freeship-rules-progress--fixed-right", placement === "fixed-right");
    root.classList.toggle(
      "freeship-rules-progress--fixed-bottom-right",
      placement === "fixed-bottom-right",
    );
    root.classList.toggle(
      "freeship-rules-progress--hide-icon",
      !settingEnabled(root.dataset.showIcon, true),
    );

    if (moveToCustomTarget(root)) return true;

    if (placement === "inline") return true;
    var summaryTarget = cartSummaryTarget();
    if (!isCartPage() && !summaryTarget) {
      root.hidden = true;
      return false;
    }

    if (floating) {
      if (
        !document.body.contains(root) ||
        root.parentElement !== document.body
      ) {
        document.body.appendChild(root);
      }
      return true;
    }

    if (placement === "cart-top") {
      var topTarget = cartPlacementTarget();
      if (topTarget && !topTarget.contains(root)) {
        topTarget.insertBefore(root, topTarget.firstChild);
      }
      return true;
    }

    if (
      (placement === "cart-page" || placement === "cart-after-checkout") &&
      summaryTarget &&
      moveToSummaryStack(root, summaryTarget, placement)
    ) {
      return true;
    }

    var target = cartPlacementTarget();
    if (target && !target.contains(root)) {
      target.insertBefore(root, target.firstChild);
    }

    return true;
  }

  function rememberRoots(blocks) {
    blocks.forEach(function (root) {
      if (progressRoots.indexOf(root) === -1) progressRoots.push(root);
    });
  }

  function applyConfig(root, config) {
    var heading = root.querySelector(".freeship-rules-progress__heading");
    if (heading) {
      heading.textContent = config.heading || "";
      heading.hidden = !config.heading || !settingEnabled(root.dataset.showHeading, true);
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
    var subtotal = cartSubtotalCents(cart, config);
    var weightEnabled = Boolean(config.weightEnabled);
    var maxWeightPounds = Number(config.maxWeightPounds || 0);
    var quantityEnabled = Boolean(config.quantityEnabled);
    var maxQuantity = Number(config.maxQuantity || 0);
    var hideWhenQualified = Boolean(config.hideWhenQualified);
    var showEmptyCart = config.showEmptyCart !== false;
    var fill = root.querySelector(".freeship-rules-progress__fill");
    var track = root.querySelector(".freeship-rules-progress__track");
    var output = root.querySelector(".freeship-rules-progress__message");
    var progress =
      goalCents > 0 ? Math.min(100, (subtotal / goalCents) * 100) : 100;
    var qualified = goalCents <= 0 || subtotal >= goalCents;
    var messages = config.messages || {};
    var targeting = productTargetingState(cart, config);

    if (!targeting.eligible) {
      root.hidden = true;
      return;
    }

    if (!showEmptyCart && cartQuantity(cart, config) === 0) {
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
    if (track)
      track.setAttribute("aria-valuenow", String(Math.round(progress)));
    if (!output) return;

    if (config.checkDiscountCode && hasDiscountCodeSignal()) {
      output.textContent = message(messages.discountCode, 0, config);
      return;
    }

    if (
      weightEnabled &&
      maxWeightPounds > 0 &&
      cartWeightPounds(cart, config) > maxWeightPounds
    ) {
      output.textContent = message(messages.weight, 0, config);
      return;
    }

    if (
      quantityEnabled &&
      maxQuantity > 0 &&
      cartQuantity(cart, config) > maxQuantity
    ) {
      output.textContent = message(messages.quantity, 0, config);
      return;
    }

    if (qualified) {
      output.textContent = message(messages.qualified, 0, config);
      return;
    }

    output.textContent = message(
      messages.awayTemplate,
      goalCents - subtotal,
      config,
    );
  }

  function roots() {
    var blocks = Array.prototype.slice.call(
      document.querySelectorAll("[data-freeship-progress]"),
    );
    var blockIds = blocks.reduce(function (ids, root) {
      if (root.id) ids[root.id] = true;
      return ids;
    }, {});

    rememberRoots(blocks);

    return blocks.concat(
      progressRoots.filter(function (root) {
        return (
          root &&
          root.nodeType === 1 &&
          !document.documentElement.contains(root) &&
          (!root.id || !blockIds[root.id])
        );
      }),
    );
  }

  function refresh() {
    var blocks = roots();
    if (blocks.length === 0) return;
    var sequence = (refreshSequence += 1);

    Promise.all([
      fetchConfig(blocks[0]),
      (nativeFetch || window.fetch)("/cart.js", {
        credentials: "same-origin",
      }).then(function (response) {
        return response.json();
      }),
    ])
      .then(function (results) {
        if (sequence !== refreshSequence) return;
        blocks.forEach(function (root) {
          updateProgress(root, results[1], results[0]);
        });
      })
      .catch(function () {
        if (sequence !== refreshSequence) return;
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
    nativeFetch = originalFetch;

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

  function watchCartFormChanges() {
    document.addEventListener("change", function (event) {
      var target = event.target;
      if (
        target &&
        target.matches &&
        target.matches(
          'input[name="updates[]"], input[name^="updates["], input[name="quantity"]',
        )
      ) {
        scheduleRefresh();
      }
    });
  }

  function watchCartDrawerTriggers() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      var trigger =
        target &&
        target.closest &&
        target.closest(
          'a[href$="/cart"], a[href*="/cart?"], [aria-controls*="Cart"], [aria-controls*="cart"], [data-cart-drawer-open], [data-cart-toggle], [data-drawer-open]',
        );

      if (!trigger) return;
      window.setTimeout(scheduleRefresh, 80);
      window.setTimeout(scheduleRefresh, 450);
    });
  }

  function start() {
    roots().forEach(applyPlacement);
    refresh();
    watchCartFetches();
    watchCartFormChanges();
    watchCartDrawerTriggers();
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

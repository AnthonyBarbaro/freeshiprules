(function () {
  if (window.FreeShipRulesProtectionLoaded) return;
  window.FreeShipRulesProtectionLoaded = true;

  var CART_PATH_PATTERN = /\/cart(?:\/(?:add|change|update|clear))?\.js(?:\?|$)/;
  var CART_PAGE_PATTERN = /\/cart\/?$/;
  var refreshTimer = null;
  var configPromise = null;
  var protectionRoots = [];
  var observer = null;
  var nativeFetch = null;
  var syncing = false;

  function appProxyRoot() {
    var shopifyRoot = window.Shopify?.routes?.root || "/";
    return (
      shopifyRoot.replace(/\/?$/, "/") +
      "apps/freeship-rules/shipping-protection-config"
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
        return { enabled: false, setupRequired: true };
      });

    return configPromise;
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
    return checkout
      ? checkout.closest(
          ".cart__blocks, .cart__footer, .cart-drawer__footer, aside, footer, section, form, div",
        )
      : null;
  }

  function cartSummaryStack() {
    var existing = document.querySelector("[data-fsr-cart-summary-stack]");
    if (existing) return existing;

    var target = cartSummaryTarget();
    if (!target) return null;

    var stack = document.createElement("div");
    stack.className = "freeship-rules-cart-stack";
    stack.setAttribute("data-fsr-cart-summary-stack", "true");

    var checkoutArea = target.querySelector(
      '.cart__ctas, button[name="checkout"], input[name="checkout"], .cart__checkout-button, a[href$="/checkout"]',
    );
    var anchor = checkoutArea?.closest?.(".cart__ctas") || checkoutArea;

    if (anchor && anchor.parentElement === target) {
      target.insertBefore(stack, anchor);
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

  function moveToSummaryStack(root) {
    var stack = cartSummaryStack();
    if (!stack) return false;

    root.dataset.fsrStackItem = "protection";
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

    root.classList.toggle("freeship-rules-protection--compact", compact);

    if (placement !== "cart-page") return true;
    if (!isCartPage()) {
      root.hidden = true;
      return false;
    }

    if (moveToSummaryStack(root)) return true;

    var target = cartPlacementTarget();
    if (target && !target.contains(root)) {
      target.insertBefore(root, target.firstChild);
    }

    return true;
  }

  function rememberRoots(blocks) {
    blocks.forEach(function (root) {
      if (protectionRoots.indexOf(root) === -1) protectionRoots.push(root);
    });
  }

  function roots() {
    var blocks = Array.prototype.slice.call(
      document.querySelectorAll("[data-freeship-protection]"),
    );
    var blockIds = blocks.reduce(function (ids, root) {
      if (root.id) ids[root.id] = true;
      return ids;
    }, {});

    rememberRoots(blocks);

    return blocks.concat(
      protectionRoots.filter(function (root) {
        return (
          root &&
          root.nodeType === 1 &&
          !document.documentElement.contains(root) &&
          (!root.id || !blockIds[root.id])
        );
      }),
    );
  }

  function protectionVariantIds(config) {
    return Object.values(config.variantMap || {}).map(function (variant) {
      return String(variant.legacyVariantId);
    });
  }

  function isProtectionItem(item, config) {
    var ids = protectionVariantIds(config);
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

  function protectedSubtotal(cart, protectionLines) {
    var subtotal = Number(cart.items_subtotal_price || cart.total_price || 0);
    var protectionTotal = protectionLines.reduce(function (sum, item) {
      return sum + Number(item.final_line_price ?? item.line_price ?? 0);
    }, 0);

    return Math.max(0, subtotal - protectionTotal);
  }

  function nonProtectionItemCount(cart, protectionLines) {
    var protectedCount = protectionLines.reduce(function (sum, item) {
      return sum + Number(item.quantity || 0);
    }, 0);

    return Math.max(0, Number(cart.item_count || 0) - protectedCount);
  }

  function priceForSubtotal(config, subtotal) {
    if (config.pricingMode === "FORMULA") {
      var formula = config.formula || {};
      var every = Math.max(1, Number(formula.everyCents || 1));
      var amount = Math.max(1, Number(formula.amountCents || 0));
      var minCharge = Math.max(0, Number(formula.minChargeCents || 0));
      var maxCharge = Math.max(0, Number(formula.maxChargeCents || 0));
      var price = Math.ceil(subtotal / every) * amount;

      if (minCharge > 0) price = Math.max(price, minCharge);
      if (maxCharge > 0) price = Math.min(price, maxCharge);
      return price;
    }

    var tiers = config.tiers || [];
    var tier = tiers.find(function (candidate) {
      return (
        subtotal >= Number(candidate.minCents || 0) &&
        (candidate.maxCents === null ||
          subtotal < Number(candidate.maxCents || 0))
      );
    });

    return tier ? Number(tier.amountCents || 0) : 0;
  }

  function variantForAmount(config, amountCents) {
    return (config.variantMap || {})[String(Math.round(amountCents))] || null;
  }

  function applyConfig(root, config, amountCents) {
    var heading = root.querySelector(".freeship-rules-protection__heading");
    var description = root.querySelector(
      ".freeship-rules-protection__description",
    );
    var price = root.querySelector(".freeship-rules-protection__price");

    if (heading) heading.textContent = config.widgetHeading || "Shipping protection";
    if (description) description.textContent = config.widgetDescription || "";
    if (price) price.textContent = money(amountCents, config.currencyCode);
  }

  function preferredSelected(root, existingItems, config) {
    if (root.dataset.protectionChoice === "selected") return true;
    if (root.dataset.protectionChoice === "declined") return false;
    if (existingItems.length > 0) return true;
    return Boolean(config.defaultSelected) && !protectionOptedOut();
  }

  function protectionOptedOut() {
    try {
      return window.localStorage.getItem("fsr-shipping-protection-opt-out") === "true";
    } catch {
      return false;
    }
  }

  function setProtectionOptOut(value) {
    try {
      if (value) {
        window.localStorage.setItem("fsr-shipping-protection-opt-out", "true");
      } else {
        window.localStorage.removeItem("fsr-shipping-protection-opt-out");
      }
    } catch {
      // Ignore storage failures.
    }
  }

  function updateProtection(root, cart, config) {
    if (!applyPlacement(root)) return;

    var checkbox = root.querySelector(".freeship-rules-protection__checkbox");
    var status = root.querySelector(".freeship-rules-protection__status");
    var lines = protectionItems(cart, config);
    var subtotal = protectedSubtotal(cart, lines);
    var itemCount = nonProtectionItemCount(cart, lines);
    var amountCents = priceForSubtotal(config, subtotal);
    var variant = variantForAmount(config, amountCents);

    if (!config.enabled || config.setupRequired || itemCount <= 0 || !variant) {
      root.hidden = true;
      if (lines.length > 0) syncProtectionLines(lines, null);
      return;
    }

    root.hidden = false;
    applyConfig(root, config, amountCents);

    var selected = preferredSelected(root, lines, config);
    root.classList.toggle("freeship-rules-protection--selected", selected);
    root.classList.toggle("freeship-rules-protection--syncing", syncing);
    if (checkbox) {
      checkbox.checked = selected;
      checkbox.disabled = syncing;
      checkbox.dataset.amountCents = String(amountCents);
    }
    if (status) {
      status.textContent = selected
        ? "Protected"
        : config.optInLabel || "Tap to protect this order";
    }

    syncProtectionLines(lines, selected ? variant : null, amountCents);
  }

  function syncProtectionLines(lines, desiredVariant, amountCents) {
    if (syncing) return;

    var desiredId = desiredVariant ? String(desiredVariant.legacyVariantId) : "";
    var alreadyCorrect =
      desiredVariant &&
      lines.length === 1 &&
      String(lines[0].variant_id) === desiredId &&
      Number(lines[0].quantity || 0) === 1;
    var alreadyRemoved = !desiredVariant && lines.length === 0;

    if (alreadyCorrect || alreadyRemoved) return;

    syncing = true;
    removeProtectionLines(lines)
      .then(function () {
        if (!desiredVariant) return null;
        return addProtectionLine(desiredVariant, amountCents);
      })
      .finally(function () {
        syncing = false;
        scheduleRefresh();
      });
  }

  function removeProtectionLines(lines) {
    return lines.reduce(function (promise, line) {
      return promise.then(function () {
        return cartChange(line.key, 0);
      });
    }, Promise.resolve());
  }

  function addProtectionLine(variant, amountCents) {
    return (nativeFetch || window.fetch)("/cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            id: Number(variant.legacyVariantId),
            quantity: 1,
            properties: {
              _freeship_shipping_protection: "true",
              _freeship_protection_price: money(amountCents),
            },
          },
        ],
      }),
    });
  }

  function cartChange(lineKey, quantity) {
    return (nativeFetch || window.fetch)("/cart/change.js", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: lineKey, quantity: quantity }),
    });
  }

  function refresh() {
    var blocks = roots();
    if (blocks.length === 0) return;

    Promise.all([
      fetchConfig(blocks[0]),
      (nativeFetch || window.fetch)("/cart.js", { credentials: "same-origin" }).then(
        function (response) {
          return response.json();
        },
      ),
    ])
      .then(function (results) {
        blocks.forEach(function (root) {
          updateProtection(root, results[1], results[0]);
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
        target.matches("[data-freeship-protection-checkbox]")
      ) {
        var root = target.closest("[data-freeship-protection]");
        if (root) {
          root.dataset.protectionChoice = target.checked ? "selected" : "declined";
          setProtectionOptOut(!target.checked);
          scheduleRefresh();
        }
        return;
      }

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

  function watchDomChanges() {
    if (!window.MutationObserver || observer) return;

    observer = new MutationObserver(function () {
      if (isCartPage()) scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    roots().forEach(applyPlacement);
    refresh();
    watchCartFetches();
    watchCartFormChanges();
    watchDomChanges();
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

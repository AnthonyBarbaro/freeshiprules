(function () {
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

  function hasDiscountCodeSignal() {
    var search = new URLSearchParams(window.location.search);
    return Boolean(
      search.get("discount") ||
      search.get("discount_code") ||
      window.location.pathname.indexOf("/discount/") !== -1,
    );
  }

  function update(root, cart) {
    var minSubtotal = Number(root.dataset.minSubtotalCents || 0);
    var maxWeight = Number(root.dataset.maxWeightGrams || 0);
    var maxQuantity = Number(root.dataset.maxQuantity || 0);
    var subtotal = Number(cart.items_subtotal_price || cart.total_price || 0);
    var weight = Number(cart.total_weight || 0);
    var quantity = Number(cart.item_count || 0);
    var fill = root.querySelector(".freeship-rules-progress__fill");
    var message = root.querySelector(".freeship-rules-progress__message");
    var progress =
      minSubtotal > 0 ? Math.min(100, (subtotal / minSubtotal) * 100) : 100;

    if (fill) fill.style.width = progress + "%";
    if (!message) return;

    if (hasDiscountCodeSignal()) {
      message.textContent = root.dataset.codeMessage || "";
      return;
    }

    if (maxWeight > 0 && weight > maxWeight) {
      message.textContent = root.dataset.weightMessage || "";
      return;
    }

    if (maxQuantity > 0 && quantity > maxQuantity) {
      message.textContent = root.dataset.quantityMessage || "";
      return;
    }

    if (subtotal >= minSubtotal) {
      message.textContent = root.dataset.qualifiedMessage || "";
      return;
    }

    message.textContent = (root.dataset.awayTemplate || "").replace(
      "{{ amount }}",
      money(minSubtotal - subtotal),
    );
  }

  function load() {
    var root = document.getElementById("freeship-rules-progress");
    if (!root) return;

    fetch("/cart.js", { credentials: "same-origin" })
      .then(function (response) {
        return response.json();
      })
      .then(function (cart) {
        update(root, cart);
      })
      .catch(function () {
        root.hidden = true;
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();

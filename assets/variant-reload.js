// Variant Image Reload
// Intercepts history.replaceState (called by product-info.js after variant selection)
// and reloads the page so the correct variant image is always displayed.
(function () {
  var originalReplaceState = history.replaceState.bind(history);
  var reloadTimer = null;

  history.replaceState = function (state, title, url) {
    // Call the original first to update URL
    originalReplaceState(state, title, url);

    // Only trigger on product pages with variant param
    if (url && url.toString().indexOf('variant=') !== -1) {
      // Cancel any pending reload (debounce for rapid option changes)
      if (reloadTimer) clearTimeout(reloadTimer);

      reloadTimer = setTimeout(function () {
        // Reload to the new variant URL so correct images load
        window.location.href = url;
      }, 500);
    }
  };
})();

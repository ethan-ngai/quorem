(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const update = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : media.matches;
    const paths = {
      ico: dark ? "/favicon-dark.ico?v=2" : "/favicon.ico?v=2",
      png: dark ? "/favicon-dark-96x96.png?v=2" : "/favicon-96x96.png?v=2",
      svg: dark ? "/favicon-dark.svg" : "/favicon-light.svg",
    };
    document.querySelectorAll("link[data-favicon]").forEach((link) => {
      const href = paths[link.dataset.favicon];
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    });
  };
  update();
  // Page preferences can override OS theme; all browser fallback formats follow them.
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  media.addEventListener("change", update);
})();

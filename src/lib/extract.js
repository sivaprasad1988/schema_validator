// Injected into the page via scripting.executeScript. Must stay self-contained (no imports, no closures).
export function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json" i]');
  return {
    url: location.href,
    title: document.title,
    blocks: Array.from(scripts, (el, index) => ({
      index,
      location: el.closest('head') ? 'head' : 'body',
      text: el.textContent ?? '',
    })),
  };
}

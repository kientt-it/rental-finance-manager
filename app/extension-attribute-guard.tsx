import Script from "next/script";

const cleanupExtensionAttributes = `
  (() => {
    const attribute = "bis_skin_checked";
    const clean = (root) => {
      if (root instanceof Element && root.hasAttribute(attribute)) {
        root.removeAttribute(attribute);
      }
      if (root.querySelectorAll) {
        root.querySelectorAll("[" + attribute + "]").forEach((node) => {
          node.removeAttribute(attribute);
        });
      }
    };

    clean(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") clean(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) clean(node);
        });
      });
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [attribute],
    });

    window.addEventListener("load", () => {
      window.setTimeout(() => observer.disconnect(), 3000);
    }, { once: true });
  })();
`;

export default function ExtensionAttributeGuard() {
  return (
    <Script id="remove-extension-attributes" strategy="beforeInteractive">
      {cleanupExtensionAttributes}
    </Script>
  );
}

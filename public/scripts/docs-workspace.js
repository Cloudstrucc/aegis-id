(function () {
  function resetSidebarScroll() {
    const sidebar = document.querySelector('.docs-sidebar');
    if (!sidebar) {
      return;
    }
    sidebar.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  function keepSidebarHeaderVisible() {
    const sidebar = document.querySelector('.docs-sidebar');
    if (!sidebar) {
      return;
    }

    try {
      if (window.sessionStorage.getItem('aegisDocsResetSidebar') === '1') {
        resetSidebarScroll();
        window.sessionStorage.removeItem('aegisDocsResetSidebar');
      }
    } catch (error) {
      resetSidebarScroll();
    }

    document.querySelectorAll('.docs-category__links a, .docs-result-link').forEach((link) => {
      link.addEventListener('click', () => {
        resetSidebarScroll();
        try {
          window.sessionStorage.setItem('aegisDocsResetSidebar', '1');
        } catch (error) {
          // Session storage can be unavailable in hardened browser contexts.
        }
      });
    });
  }

  async function renderMermaidDiagrams() {
    const diagrams = Array.from(document.querySelectorAll('.docs-reader__content .mermaid'));
    if (!diagrams.length) {
      return;
    }

    if (!window.mermaid) {
      diagrams.forEach((diagram) => {
        diagram.classList.add('mermaid--error');
        diagram.setAttribute('data-error', 'Mermaid assets unavailable');
      });
      return;
    }

    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          primaryColor: '#f7fafd',
          primaryBorderColor: '#d9e4ef',
          primaryTextColor: '#071928',
          lineColor: '#216be6',
          secondaryColor: '#eaf2ff',
          tertiaryColor: '#ffffff',
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      });
      try {
        await window.mermaid.run({ nodes: diagrams });
      } catch (runError) {
        if (typeof window.mermaid.init === 'function') {
          await window.mermaid.init(undefined, diagrams);
        } else {
          throw runError;
        }
      }
    } catch (error) {
      console.error('Unable to render Mermaid docs diagrams.', error);
      diagrams.forEach((diagram) => {
        diagram.classList.add('mermaid--error');
        diagram.setAttribute('data-error', 'Diagram render failed');
      });
    }
  }

  function initDocsWorkspace() {
    keepSidebarHeaderVisible();
    renderMermaidDiagrams();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDocsWorkspace);
  } else {
    initDocsWorkspace();
  }
})();

const revealNodes = document.querySelectorAll('.reveal, .doc-reveal');

if (!('IntersectionObserver' in window)) {
  revealNodes.forEach((node) => {
    node.classList.add('is-visible', 'doc-is-visible');
  });
} else {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible', 'doc-is-visible');
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16 }
  );

  revealNodes.forEach((node) => revealObserver.observe(node));
}

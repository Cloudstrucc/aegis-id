const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible', 'doc-is-visible');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.16 }
);

document.querySelectorAll('.reveal, .doc-reveal').forEach((node) => {
  if (!observer) {
    node.classList.add('is-visible', 'doc-is-visible');
    return;
  }
  observer.observe(node);
});

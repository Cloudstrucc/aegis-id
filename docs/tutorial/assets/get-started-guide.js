const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add(entry.target.classList.contains('doc-reveal') ? 'doc-is-visible' : 'is-visible');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.16 }
);

document.querySelectorAll('.reveal, .doc-reveal').forEach((node) => observer.observe(node));

/* Applies the stored colour theme before first paint.
 *
 * A separate file rather than an inline <script> because the Content Security
 * Policy is script-src 'self' with no 'unsafe-inline' — an inline block is
 * blocked outright, which is how this was caught. Loaded without defer in the
 * head so it runs before the body paints; without that, a viewer who chose
 * light on a dark-themed computer sees a dark flash on every navigation.
 *
 * Storage throws in a private window or with site data blocked. That is fine:
 * the page then follows the operating system, which is the default anyway.
 */
(function () {
  try {
    var choice = localStorage.getItem('aegis-theme');
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch (error) { /* no storage: fall through to prefers-color-scheme */ }
})();

// Wallet setup: stop asking the reader to refresh.
//
// The onboarding route already redirects to the dashboard the moment a wallet
// has accepted the invitation, so there is nothing to poll for and no state to
// reconcile — asking for this page again is the whole check. The page used to
// say "refresh after acceptance if this page does not update automatically",
// which is an instruction to notice that nothing is happening.
//
// A failed or blocked script leaves the "Check now" link, which is the same
// request made by hand.

(function () {
  'use strict';

  var panel = document.querySelector('[data-onboarding-check]');
  if (!panel) {
    return;
  }

  var path = panel.getAttribute('data-onboarding-check');
  var note = panel.querySelector('[data-onboarding-check-note]');
  if (!path) {
    return;
  }

  // Long enough not to hammer the server while somebody finds their phone,
  // short enough that accepting the invitation feels like it did something.
  var INTERVAL_MS = 6000;
  // An abandoned tab should not poll for the rest of the day.
  var GIVE_UP_AFTER_MS = 15 * 60 * 1000;

  var startedAt = Date.now();
  var inFlight = false;
  var timer = null;

  function stop(message) {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    if (note && message) {
      note.textContent = message;
    }
  }

  function check() {
    // A hidden tab is nobody waiting.
    if (inFlight || document.hidden) {
      return;
    }
    if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
      stop('Stopped checking. Use Check now when the wallet has accepted.');
      return;
    }

    inFlight = true;
    window
      .fetch(path, { headers: { Accept: 'text/html' }, redirect: 'follow' })
      .then(function (response) {
        // The route sends us somewhere else exactly when there is somewhere
        // else to go: the dashboard once a wallet has accepted, or sign-in if
        // the session has ended. Either is the answer, so follow it.
        if (response.redirected && response.url && response.url.indexOf('/onboarding') === -1) {
          stop('Opening the dashboard.');
          window.location.assign(response.url);
        }
      })
      .catch(function () {
        // Offline, or the server is restarting. The next tick tries again and
        // the link is still there; saying so would be noise.
      })
      .then(function () {
        inFlight = false;
      });
  }

  timer = window.setInterval(check, INTERVAL_MS);

  // Coming back to the tab is the most likely moment for this to have changed,
  // because the reader was just on their phone accepting it.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      check();
    }
  });
})();

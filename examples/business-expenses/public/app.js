const challengeShell = document.querySelector('[data-challenge-id]');

if (challengeShell) {
  const challengeId = challengeShell.dataset.challengeId;
  const returnTo = challengeShell.dataset.returnTo || '/expenses';
  const statusElement = document.querySelector('[data-challenge-status]');

  window.setInterval(async () => {
    try {
      const response = await fetch(`/challenge/${challengeId}/status?returnTo=${encodeURIComponent(returnTo)}`);
      const payload = await response.json();
      if (payload.status === 'accepted') {
        statusElement.textContent = 'Wallet accepted. Returning to application...';
        window.location.assign(payload.returnTo || returnTo);
        return;
      }
      statusElement.textContent = `Wallet challenge status: ${payload.status}`;
    } catch (error) {
      statusElement.textContent = 'Waiting for wallet acceptance.';
    }
  }, 2200);
}

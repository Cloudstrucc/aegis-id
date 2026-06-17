const challengeShell = document.querySelector('[data-challenge-id]');
const verifiedIdShell = document.querySelector('[data-verified-id-transaction]');
const yubiKeyShell = document.querySelector('[data-yubikey-step-up]');

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

if (verifiedIdShell) {
  const transactionId = verifiedIdShell.dataset.verifiedIdTransaction;
  const returnTo = verifiedIdShell.dataset.returnTo || '/expenses';
  const statusElement = document.querySelector('[data-verified-id-status]');
  const messageElement = document.querySelector('[data-verified-id-message]');

  window.setInterval(async () => {
    try {
      const response = await fetch(`/verified-id/${transactionId}/status?returnTo=${encodeURIComponent(returnTo)}`);
      const payload = await response.json();
      const status = payload.callbackStatus || payload.status;
      statusElement.textContent = status;

      if (payload.status === 'verified' || payload.callbackStatus === 'presentation_verified') {
        messageElement.textContent = 'Verified ID accepted. Returning to application...';
        window.location.assign(payload.returnTo || returnTo);
        return;
      }

      if (payload.callbackStatus === 'presentation_error') {
        messageElement.textContent = 'Verified ID presentation failed. Create a new sign-in request and try again.';
        return;
      }

      messageElement.textContent = `Verified ID status: ${status}`;
    } catch (error) {
      messageElement.textContent = 'Waiting for Microsoft Authenticator.';
    }
  }, 2200);
}

if (yubiKeyShell) {
  const stepUpId = yubiKeyShell.dataset.yubikeyStepUp;
  const returnTo = yubiKeyShell.dataset.returnTo || '/expenses';
  const messageElement = document.querySelector('[data-yubikey-message]');
  const startButton = document.querySelector('[data-yubikey-start]');
  const simulateButton = document.querySelector('[data-yubikey-simulate]');
  const optionsElement = document.querySelector('[data-yubikey-options]');

  startButton?.addEventListener('click', async () => {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.create) {
        throw new Error('This browser does not expose WebAuthn credential creation.');
      }

      setYubiKeyMessage('Waiting for your YubiKey, NFC security key, or passkey prompt...');
      const publicKey = normalizePublicKeyOptions(JSON.parse(optionsElement.textContent));
      const credential = await navigator.credentials.create({ publicKey });
      await completeYubiKeyStepUp(stepUpId, returnTo, {
        credentialId: credential.id,
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment || 'cross-platform',
        clientExtensionResults: credential.getClientExtensionResults?.() || {}
      });
    } catch (error) {
      setYubiKeyMessage(`${error.message} You can use the pilot fallback for a no-hardware walkthrough.`);
    }
  });

  simulateButton?.addEventListener('click', async () => {
    setYubiKeyMessage('Recording simulated YubiKey pilot event...');
    await completeYubiKeyStepUp(stepUpId, returnTo, {
      credentialId: `pilot-yubikey-${Date.now()}`,
      authenticatorAttachment: 'cross-platform',
      simulated: true
    });
  });

  function setYubiKeyMessage(message) {
    messageElement.textContent = message;
  }
}

function normalizePublicKeyOptions(input) {
  const publicKey = {
    ...input,
    challenge: base64UrlToUint8Array(input.challenge),
    user: {
      id: base64UrlToUint8Array(input.user?.id || ''),
      name: input.user?.name || 'identity@vanguardcs.ca',
      displayName: input.user?.displayName || input.user?.name || 'Vanguard Pilot User'
    }
  };

  if (!publicKey.rp?.id) {
    publicKey.rp = { name: publicKey.rp?.name || 'Vanguard Aegis ID' };
  }

  return publicKey;
}

function base64UrlToUint8Array(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function completeYubiKeyStepUp(stepUpId, returnTo, body) {
  const response = await fetch(`/yubikey/${stepUpId}/complete?returnTo=${encodeURIComponent(returnTo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || 'YubiKey step-up failed.');
  }
  window.location.assign(payload.returnTo || returnTo);
}

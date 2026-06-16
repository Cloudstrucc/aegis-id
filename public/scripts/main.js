const output = document.querySelector('[data-demo-output]');
const demoResult = document.querySelector('[data-demo-result]');
const videoModal = document.querySelector('[data-video-modal]');
const videoPlayer = document.querySelector('[data-video-player]');
const oidcChallengeGate = document.querySelector('[data-oidc-session-id]');
let lastVideoTrigger = null;

const demoActions = {
  issue: {
    url: '/api/issuer/create-offer',
    method: 'POST',
    body: {
      displayName: 'Vanguard Pilot User',
      email: 'pilot@vanguardcs.ca',
      department: 'Architecture',
      role: 'Identity Pilot'
    }
  },
  verify: {
    url: '/api/verifier/create-request',
    method: 'POST',
    body: {}
  },
  aries: {
    url: '/api/aries/status',
    method: 'GET'
  }
};

document.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-copy-value]');
  if (copyButton) {
    await copyToClipboard(copyButton);
    return;
  }

  const openVideoButton = event.target.closest('[data-video-open]');
  if (openVideoButton && videoModal) {
    lastVideoTrigger = openVideoButton;
    openVideoModal();
    return;
  }

  const closeVideoButton = event.target.closest('[data-video-close]');
  if (closeVideoButton && videoModal) {
    closeVideoModal();
    return;
  }

  const button = event.target.closest('[data-demo-action]');
  if (!button || !output) {
    return;
  }

  const action = demoActions[button.dataset.demoAction];
  if (!action) {
    return;
  }

  button.disabled = true;
  output.textContent = 'Running...';
  renderDemoResult(null);

  try {
    const response = await fetch(action.url, {
      method: action.method,
      headers: action.body ? { 'Content-Type': 'application/json' } : undefined,
      body: action.body ? JSON.stringify(action.body) : undefined
    });
    const payload = await response.json();
    output.textContent = JSON.stringify(payload, null, 2);
    renderDemoResult(payload, button.dataset.demoAction);
  } catch (error) {
    output.textContent = JSON.stringify({ error: error.message }, null, 2);
    renderDemoResult(null);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && videoModal && !videoModal.hidden) {
    closeVideoModal();
  }
});

if (oidcChallengeGate) {
  pollOidcWalletChallenge(oidcChallengeGate);
}

document.querySelectorAll('[data-logo-upload]').forEach((input) => {
  input.addEventListener('change', () => handleLogoUpload(input));
});

function openVideoModal() {
  videoModal.hidden = false;
  document.body.classList.add('modal-open');
  videoPlayer?.focus();
}

function closeVideoModal() {
  if (videoPlayer) {
    videoPlayer.pause();
    videoPlayer.currentTime = 0;
  }
  videoModal.hidden = true;
  document.body.classList.remove('modal-open');
  lastVideoTrigger?.focus();
}

function pollOidcWalletChallenge(gate) {
  const sessionId = gate.dataset.oidcSessionId;
  const appUrl = gate.dataset.oidcAppUrl;
  const statusElement = document.querySelector('[data-oidc-challenge-status]');

  if (!sessionId || !statusElement) {
    return;
  }

  const interval = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/oidc-wallet/sessions/${sessionId}`);
      const payload = await response.json();

      if (payload.status === 'authenticated') {
        statusElement.textContent = 'Wallet accepted. Opening protected app...';
        window.clearInterval(interval);
        window.location.assign(payload.appUrl || appUrl);
        return;
      }

      if (payload.walletChallenge?.status) {
        statusElement.textContent = `Wallet challenge status: ${payload.walletChallenge.status}`;
      }
    } catch (error) {
      statusElement.textContent = 'Waiting for wallet acceptance.';
    }
  }, 2200);
}

async function copyToClipboard(button) {
  const originalLabel = button.textContent;

  try {
    await navigator.clipboard.writeText(button.dataset.copyValue);
    button.textContent = 'Copied';
  } catch (error) {
    button.textContent = 'Copy failed';
  }

  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1600);
}

function renderDemoResult(payload, actionName) {
  if (!demoResult) {
    return;
  }

  demoResult.replaceChildren();
  demoResult.hidden = true;

  if (!payload) {
    return;
  }

  const cards = [];

  if (actionName === 'issue' && payload.iosWalletInvitation) {
    cards.push(
      createQrCard({
        eyebrow: 'iOS Aries lab',
        title: 'Scan with Vanguard Aegis ID Wallet',
        description:
          payload.iosWalletInvitation.ok === false
            ? 'Start the Aries issuer container to generate an iOS wallet invitation QR.'
            : 'Scan this with iPhone Camera or inside the Vanguard Aegis ID wallet. Microsoft Authenticator will not accept Aries invitations.',
        qrCodeDataUrl: payload.iosWalletInvitation.iosQrCodeDataUrl || payload.iosWalletInvitation.qrCodeDataUrl,
        requestUrl:
          payload.iosWalletInvitation.iosDeepLinkUrl ||
          payload.iosWalletInvitation.invitationUrl ||
          payload.iosWalletInvitation.requestUrl,
        secondaryUrl: payload.iosWalletInvitation.invitationUrl,
        secondaryLabel: 'Raw Aries invitation',
        phoneReachable: payload.iosWalletInvitation.phoneReachable,
        phoneHint:
          'The underlying Aries endpoint uses localhost. For iPhone testing, set the Aries endpoint to your Mac LAN IP and recreate the lab containers.',
        error: payload.iosWalletInvitation.ok === false ? payload.iosWalletInvitation : null
      })
    );
  }

  if (payload.qrCodeDataUrl) {
    cards.push(
      createQrCard({
        eyebrow: payload.kind === 'presentation' ? 'Verified ID presentation' : 'Verified ID issuance',
        title: payload.kind === 'presentation' ? 'Scan Presentation Request' : 'Scan Microsoft Wallet Offer',
        description:
          payload.kind === 'presentation'
            ? 'Verified ID presentation request QR for a compatible Microsoft wallet.'
            : 'Verified ID issuance offer QR for Microsoft Authenticator or the mock wallet page.',
        qrCodeDataUrl: payload.qrCodeDataUrl,
        requestUrl: payload.requestUrl,
        phoneReachable: isPhoneReachableUrl(payload.requestUrl),
        phoneHint: 'This QR uses localhost. For iPhone testing, set PUBLIC_BASE_URL to your Mac LAN IP or deployed HTTPS URL.'
      })
    );
  }

  if (!cards.length) {
    return;
  }

  cards.forEach((card) => demoResult.append(card));
  demoResult.hidden = false;
}

function handleLogoUpload(input) {
  const file = input.files?.[0];
  const hiddenInput = input.closest('form')?.querySelector('[data-logo-data-url]');

  if (!hiddenInput) {
    return;
  }

  hiddenInput.value = '';
  if (!file) {
    return;
  }

  if (file.size > 850 * 1024) {
    input.value = '';
    window.alert('Please choose a logo under 850 KB for this local pilot.');
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    hiddenInput.value = String(reader.result || '');
  });
  reader.readAsDataURL(file);
}

function createQrCard({
  eyebrow,
  title,
  description,
  qrCodeDataUrl,
  requestUrl,
  secondaryUrl,
  secondaryLabel,
  phoneReachable,
  phoneHint,
  error
}) {
  const card = document.createElement('article');
  card.className = 'demo-qr-card';

  const eyebrowElement = document.createElement('p');
  eyebrowElement.className = 'eyebrow';
  eyebrowElement.textContent = eyebrow;
  card.append(eyebrowElement);

  const titleElement = document.createElement('h3');
  titleElement.textContent = title;
  card.append(titleElement);

  const descriptionElement = document.createElement('p');
  descriptionElement.className = 'demo-qr-card__description';
  descriptionElement.textContent = description;
  card.append(descriptionElement);

  if (qrCodeDataUrl) {
    const image = document.createElement('img');
    image.className = 'demo-qr-card__image';
    image.src = qrCodeDataUrl;
    image.alt = `${title} QR code`;
    card.append(image);
  }

  if (error) {
    const errorElement = document.createElement('p');
    errorElement.className = 'demo-qr-card__error';
    errorElement.textContent = error.hint || error.message || 'Unable to create the Aries wallet invitation.';
    card.append(errorElement);
  }

  if (requestUrl) {
    const code = document.createElement('code');
    code.className = 'demo-qr-card__url';
    code.textContent = requestUrl;
    card.append(code);

    const copyButton = document.createElement('button');
    copyButton.className = 'button button--secondary demo-qr-card__copy';
    copyButton.type = 'button';
    copyButton.dataset.copyValue = requestUrl;
    copyButton.textContent = 'Copy link';
    card.append(copyButton);
  }

  if (secondaryUrl && secondaryUrl !== requestUrl) {
    const secondary = document.createElement('details');
    secondary.className = 'demo-qr-card__details';

    const summary = document.createElement('summary');
    summary.textContent = secondaryLabel || 'Alternate link';
    secondary.append(summary);

    const code = document.createElement('code');
    code.className = 'demo-qr-card__url';
    code.textContent = secondaryUrl;
    secondary.append(code);

    const copyButton = document.createElement('button');
    copyButton.className = 'button button--secondary demo-qr-card__copy';
    copyButton.type = 'button';
    copyButton.dataset.copyValue = secondaryUrl;
    copyButton.textContent = 'Copy raw link';
    secondary.append(copyButton);

    card.append(secondary);
  }

  if (requestUrl && phoneReachable === false) {
    const hint = document.createElement('p');
    hint.className = 'demo-qr-card__warning';
    hint.textContent = phoneHint || 'This QR uses localhost. For iPhone testing, use a phone-reachable host.';
    card.append(hint);
  }

  return card;
}

function isPhoneReachableUrl(value) {
  try {
    const url = new URL(value);
    return !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch (error) {
    return false;
  }
}

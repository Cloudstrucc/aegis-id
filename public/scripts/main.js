const output = document.querySelector('[data-demo-output]');
const demoResult = document.querySelector('[data-demo-result]');
const videoModal = document.querySelector('[data-video-modal]');
const videoPlayer = document.querySelector('[data-video-player]');
const oidcChallengeGate = document.querySelector('[data-oidc-session-id]');
const mediaPipeFaceDetectionBase = '/vendor/mediapipe/face_detection';
let lastVideoTrigger = null;
let lastAppModalTrigger = null;
let faceDetectionLibraryPromise = null;
const idvWizardState = new WeakMap();

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

  const bladeLink = event.target.closest('[data-blade-link]');
  if (bladeLink) {
    activateWorkspaceBladeFromLink(bladeLink, event);
    return;
  }

  const registerPasskeyButton = event.target.closest('[data-passkey-register]');
  if (registerPasskeyButton) {
    await handlePasskey(registerPasskeyButton, 'register');
    return;
  }

  const authenticatePasskeyButton = event.target.closest('[data-passkey-authenticate]');
  if (authenticatePasskeyButton) {
    await handlePasskey(authenticatePasskeyButton, 'authenticate');
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

  const modalTrigger = event.target.closest('[data-modal-target]');
  if (modalTrigger) {
    openAppModal(modalTrigger.dataset.modalTarget, modalTrigger);
    return;
  }

  const modalClose = event.target.closest('[data-modal-close]');
  if (modalClose) {
    closeAppModal(modalClose.closest('.app-modal'));
    return;
  }

  const dismissBanner = event.target.closest('[data-dismiss-banner]');
  if (dismissBanner) {
    dismissDashboardBanner(dismissBanner.closest('[data-dismissible-banner]'));
    return;
  }

  const idvNext = event.target.closest('[data-idv-next]');
  if (idvNext) {
    const form = idvNext.closest('[data-idv-form]');
    setIdvStep(form, idvNext.dataset.idvNext);
    return;
  }

  const idvBack = event.target.closest('[data-idv-back]');
  if (idvBack) {
    const form = idvBack.closest('[data-idv-form]');
    setIdvStep(form, idvBack.dataset.idvBack);
    return;
  }

  const idvStartCamera = event.target.closest('[data-idv-start-camera]');
  if (idvStartCamera) {
    await startIdvCamera(idvStartCamera.closest('[data-idv-form]'), idvStartCamera);
    return;
  }

  const idvCapture = event.target.closest('[data-idv-capture]');
  if (idvCapture) {
    captureIdvFace(idvCapture.closest('[data-idv-form]'));
    return;
  }

  const idvStartOver = event.target.closest('[data-idv-start-over]');
  if (idvStartOver) {
    resetIdvWizard(idvStartOver.closest('[data-idv-form]'));
    return;
  }

  const row = event.target.closest('[data-row-modal]');
  if (row && !event.target.closest('a, button, input, select, textarea, label, summary, details')) {
    openAppModal(row.dataset.rowModal, row);
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

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-confirm-message]');
  if (!form) {
    return;
  }

  const message = form.dataset.confirmMessage || 'Are you sure?';
  if (!window.confirm(message)) {
    event.preventDefault();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && videoModal && !videoModal.hidden) {
    closeVideoModal();
  }
  if (event.key === 'Escape') {
    closeAppModal(document.querySelector('.app-modal:not([hidden])'));
  }
});

if (oidcChallengeGate) {
  pollOidcWalletChallenge(oidcChallengeGate);
}

document.querySelectorAll('[data-logo-upload]').forEach((input) => {
  input.addEventListener('change', () => handleLogoUpload(input));
});

document.querySelectorAll('[data-image-to-hidden]').forEach((input) => {
  input.addEventListener('change', () => handleImageEvidence(input));
});

document.querySelectorAll('[data-role-template-select]').forEach((select) => {
  select.addEventListener('change', () => applyRoleTemplate(select));
});

restoreDismissibleBanners();
// Workspace tour is disabled while the onboarding guide is being redesigned.
// The setup/configuration wizards remain available from the portal.
// initWorkspaceTour();
initWorkspaceBlade();
initAdminIdvWizard(document.querySelector('[data-idv-form]'));
openInviteModalFromHash();

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

function openAppModal(selector, trigger) {
  const modal = document.querySelector(selector);
  if (!modal) {
    return;
  }

  closeAppModal(document.querySelector('.app-modal:not([hidden])'), false);
  lastAppModalTrigger = trigger || null;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  initAdminIdvWizard(modal.querySelector('[data-idv-form]'));
  const firstFocusable = modal.querySelector('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])');
  firstFocusable?.focus();
}

function closeAppModal(modal, restoreFocus = true) {
  if (!modal || modal.hidden) {
    return;
  }

  stopIdvCamera(modal.querySelector('[data-idv-form]'));
  modal.hidden = true;
  if (!document.querySelector('.app-modal:not([hidden])') && (!videoModal || videoModal.hidden)) {
    document.body.classList.remove('modal-open');
  }
  if (restoreFocus) {
    lastAppModalTrigger?.focus?.();
  }
}

function initWorkspaceBlade() {
  const shell = document.querySelector('[data-workspace-blade]');
  if (!shell) {
    return;
  }

  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
  window.addEventListener('hashchange', () => activateWorkspaceBladeFromHash(window.location.hash));
  activateWorkspaceBladeFromHash(window.location.hash || '#dashboard-overview');
  requestAnimationFrame(() => resetWorkspaceBladeScroll(shell, false));
  window.setTimeout(() => resetWorkspaceBladeScroll(shell, false), 80);
}

function activateWorkspaceBladeFromLink(link, event) {
  const shell = document.querySelector('[data-workspace-blade]');
  if (!shell) {
    return;
  }

  const href = link.getAttribute('href') || '';
  if (!href.startsWith('#')) {
    return;
  }

  event?.preventDefault();
  activateWorkspaceBlade(link.dataset.bladeLink, href);
  if (window.location.hash !== href) {
    window.history.pushState({}, '', href);
  }
}

function activateWorkspaceBladeFromHash(hash) {
  const shell = document.querySelector('[data-workspace-blade]');
  if (!shell) {
    return;
  }

  const normalizedHash = hash || '#dashboard-overview';
  const matchingLink = shell.querySelector(`[data-blade-link][href="${cssEscape(normalizedHash)}"]`);
  activateWorkspaceBlade(matchingLink?.dataset.bladeLink, normalizedHash);
}

function activateWorkspaceBlade(key, hash) {
  const shell = document.querySelector('[data-workspace-blade]');
  const panels = [...shell.querySelectorAll('[data-blade-panel]')];
  if (panels.length === 0) {
    return;
  }

  const target = findBladePanel(shell, key, hash) || panels[0];
  const targetKey = key || target.dataset.bladePanel;
  for (const panel of panels) {
    const active = panel === target;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
  for (const link of shell.querySelectorAll('[data-blade-link]')) {
    link.classList.toggle('is-active', link.dataset.bladeLink === targetKey);
  }
  resetWorkspaceBladeScroll(shell, true);
}

function resetWorkspaceBladeScroll(shell, smooth = true) {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  const content = shell.querySelector('.workspace-blade__content');
  if (content) {
    content.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }
}

function findBladePanel(shell, key, hash) {
  if (key) {
    const keyed = shell.querySelector(`[data-blade-panel="${cssEscape(key)}"]`);
    if (keyed) {
      return keyed;
    }
  }
  if (hash?.startsWith('#')) {
    const targetId = decodeURIComponent(hash.slice(1));
    const targetElement = document.getElementById(targetId);
    return targetElement?.closest('[data-blade-panel]');
  }
  return null;
}

function cssEscape(value = '') {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, '\\$&');
}

function applyRoleTemplate(select) {
  const form = select.closest('form');
  const option = select.selectedOptions?.[0];
  if (!form || !option || !option.value) {
    return;
  }

  const privileges = new Set(
    String(option.dataset.privileges || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  form.querySelectorAll('input[name="privilegeIds"]').forEach((checkbox) => {
    checkbox.checked = privileges.has(checkbox.value);
  });
  const adminRole = form.querySelector('input[name="adminRole"]');
  if (adminRole) {
    adminRole.checked = option.dataset.adminRole === 'true';
  }
}

async function handlePasskey(button, mode) {
  const status = document.querySelector('[data-passkey-status]');
  const originalLabel = button.textContent;

  if (!window.PublicKeyCredential || !navigator.credentials) {
    setPasskeyStatus(status, 'This browser does not support passkeys.');
    return;
  }

  button.disabled = true;
  button.textContent = mode === 'register' ? 'Creating...' : 'Verifying...';
  setPasskeyStatus(status, 'Waiting for passkey approval.');

  try {
    const optionsResponse = await fetch(`/auth/passkeys/${mode}/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    });
    const options = await optionsResponse.json();
    if (!optionsResponse.ok) {
      throw new Error(options.error?.message || options.message || 'Unable to start passkey flow.');
    }

    const credential =
      mode === 'register'
        ? await navigator.credentials.create({ publicKey: prepareCreationOptions(options) })
        : await navigator.credentials.get({ publicKey: prepareRequestOptions(options) });

    const verifyResponse = await fetch(`/auth/passkeys/${mode}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(serializePublicKeyCredential(credential))
    });
    const payload = await verifyResponse.json();
    if (!verifyResponse.ok) {
      throw new Error(payload.error?.message || payload.message || 'Passkey verification failed.');
    }

    setPasskeyStatus(status, 'Passkey verified. Opening your account...');
    window.location.assign(payload.redirectUrl || '/account');
  } catch (error) {
    setPasskeyStatus(status, error.message || 'Passkey flow was cancelled.');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function setPasskeyStatus(status, message) {
  if (status) {
    status.textContent = message;
  }
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

function handleImageEvidence(input) {
  const key = input.dataset.imageToHidden;
  const hiddenInput = input.closest('form')?.querySelector(`[data-image-hidden="${key}"]`);

  if (!hiddenInput) {
    return;
  }

  hiddenInput.value = '';
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  if (file.size > 850 * 1024) {
    input.value = '';
    window.alert('Please choose an image under 850 KB for this lab verification.');
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const value = String(reader.result || '');
    hiddenInput.value = value;
    input.closest('form')?.dispatchEvent(
      new CustomEvent('aegis:image-ready', {
        bubbles: true,
        detail: { key, value }
      })
    );
  });
  reader.readAsDataURL(file);
}

function initAdminIdvWizard(form) {
  if (!form || form.dataset.idvInitialized === 'true') {
    return;
  }

  form.dataset.idvInitialized = 'true';
  idvWizardState.set(form, {
    stream: null,
    detector: null,
    running: false,
    cameraReady: false,
    latestScore: 0,
    faceCaptured: false
  });
  form.addEventListener('aegis:image-ready', (event) => {
    if (event.detail?.key === 'idImageDataUrl') {
      renderIdvPreview(form.querySelector('[data-idv-id-preview]'), event.detail.value, 'Government ID preview');
      renderIdvPreview(form.querySelector('[data-idv-analysis-id]'), event.detail.value, 'Government ID evidence');
      updateIdvControls(form);
    }
  });
  form.addEventListener('submit', (event) => {
    const idImage = form.querySelector('[data-image-hidden="idImageDataUrl"]')?.value;
    const faceImage = form.querySelector('[data-image-hidden="faceImageDataUrl"]')?.value;
    if (!idImage || !faceImage) {
      event.preventDefault();
      setIdvStatus(form, 'Complete the ID upload and live face capture before submitting.');
      setIdvStep(form, idImage ? 'face' : 'document');
    }
  });
  setIdvStep(form, 'document');
  updateIdvControls(form);
}

function setIdvStep(form, stepName) {
  if (!form || !stepName) {
    return;
  }

  form.querySelectorAll('[data-idv-step]').forEach((step) => {
    step.hidden = step.dataset.idvStep !== stepName;
  });
  form.querySelectorAll('[data-idv-step-indicator]').forEach((indicator) => {
    const active = indicator.dataset.idvStepIndicator === stepName;
    indicator.classList.toggle('is-active', active);
    indicator.classList.toggle('is-complete', isIdvStepComplete(form, indicator.dataset.idvStepIndicator));
  });
  updateIdvControls(form);
}

function isIdvStepComplete(form, stepName) {
  if (stepName === 'document') {
    return Boolean(form.querySelector('[data-image-hidden="idImageDataUrl"]')?.value);
  }
  if (stepName === 'face') {
    return Boolean(form.querySelector('[data-image-hidden="faceImageDataUrl"]')?.value);
  }
  return false;
}

function updateIdvControls(form) {
  if (!form) {
    return;
  }

  const idReady = Boolean(form.querySelector('[data-image-hidden="idImageDataUrl"]')?.value);
  const faceReady = Boolean(form.querySelector('[data-image-hidden="faceImageDataUrl"]')?.value);
  const state = idvWizardState.get(form);
  const nextButton = form.querySelector('[data-idv-next="face"]');
  const captureButton = form.querySelector('[data-idv-capture]');
  const submitButton = form.querySelector('[data-idv-submit]');
  if (nextButton) {
    nextButton.disabled = !idReady;
  }
  if (captureButton) {
    captureButton.disabled = !state?.cameraReady;
  }
  if (submitButton) {
    submitButton.disabled = !idReady || !faceReady;
  }
}

async function startIdvCamera(form, button) {
  if (!form) {
    return;
  }

  const state = idvWizardState.get(form) || {};
  if (state.running) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setIdvStatus(form, 'This browser does not expose camera capture. Try Safari, Chrome, or Edge over HTTPS or localhost.');
    return;
  }

  const originalLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Starting...';
  }
  setIdvStatus(form, 'Requesting camera permission.');

  try {
    const video = form.querySelector('[data-idv-video]');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
    await video.play();

    setIdvStatus(form, 'Loading open-source face detection.');
    const FaceDetection = await loadFaceDetectionLibrary();
    const detector = new FaceDetection({
      locateFile: (file) => `${mediaPipeFaceDetectionBase}/${file}`
    });
    detector.setOptions({
      model: 'short',
      minDetectionConfidence: 0.72
    });
    detector.onResults((results) => handleIdvFaceResults(form, results));

    const nextState = {
      ...state,
      stream,
      detector,
      running: true,
      cameraReady: false,
      latestScore: 0,
      faceCaptured: false
    };
    idvWizardState.set(form, nextState);
    form.querySelector('[data-idv-camera-placeholder]')?.setAttribute('hidden', '');
    form.querySelector('[data-idv-camera-frame]')?.classList.remove('is-ready', 'is-warning');
    setIdvStatus(form, 'Center your face inside the guide.');
    updateIdvControls(form);
    runIdvDetectionLoop(form);
  } catch (error) {
    setIdvStatus(form, error.message || 'Unable to start camera capture.');
    stopIdvCamera(form);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel || 'Start Camera';
    }
  }
}

function loadFaceDetectionLibrary() {
  if (window.FaceDetection) {
    return Promise.resolve(window.FaceDetection);
  }

  if (!faceDetectionLibraryPromise) {
    faceDetectionLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${mediaPipeFaceDetectionBase}/face_detection.js`;
      script.async = true;
      script.addEventListener('load', () => {
        if (window.FaceDetection) {
          resolve(window.FaceDetection);
        } else {
          reject(new Error('Face detection library loaded without exposing FaceDetection.'));
        }
      });
      script.addEventListener('error', () => reject(new Error('Unable to load MediaPipe Face Detection assets.')));
      document.head.append(script);
    });
  }

  return faceDetectionLibraryPromise;
}

async function runIdvDetectionLoop(form) {
  const state = idvWizardState.get(form);
  const video = form?.querySelector('[data-idv-video]');
  if (!state?.running || !state.detector || !video) {
    return;
  }

  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      await state.detector.send({ image: video });
    }
  } catch (error) {
    setIdvStatus(form, error.message || 'Face detection paused. Try restarting the camera.');
    state.cameraReady = false;
    updateIdvControls(form);
  }

  if (idvWizardState.get(form)?.running) {
    window.requestAnimationFrame(() => runIdvDetectionLoop(form));
  }
}

function handleIdvFaceResults(form, results) {
  const state = idvWizardState.get(form);
  if (!state?.running) {
    return;
  }

  const detections = results?.detections || [];
  const detection = detections.length === 1 ? detections[0] : null;
  const frame = form.querySelector('[data-idv-camera-frame]');
  if (!detection) {
    state.cameraReady = false;
    state.latestScore = 0;
    frame?.classList.remove('is-ready');
    frame?.classList.add('is-warning');
    setIdvStatus(form, detections.length > 1 ? 'Only one face should be visible.' : 'Looking for a face.');
    updateIdvControls(form);
    return;
  }

  const box = detection.boundingBox || {};
  const width = Number(box.width) || 0;
  const height = Number(box.height) || 0;
  const centerDistance = Math.hypot((Number(box.xCenter) || 0.5) - 0.5, (Number(box.yCenter) || 0.5) - 0.5);
  const sizeOk = width >= 0.18 && width <= 0.72 && height >= 0.18 && height <= 0.84;
  const centered = centerDistance <= 0.18;
  const score = clampNumber(0.72 + (0.18 - Math.min(centerDistance, 0.18)) * 1.2 + (sizeOk ? 0.08 : 0), 0.72, 0.99);

  state.latestScore = Math.round(score * 100) / 100;
  state.cameraReady = centered && sizeOk;
  frame?.classList.toggle('is-ready', state.cameraReady);
  frame?.classList.toggle('is-warning', !state.cameraReady);
  setIdvStatus(
    form,
    state.cameraReady
      ? `Face captured by detector. Ready score ${Math.round(state.latestScore * 100)}%.`
      : 'Move closer and center your face inside the guide.'
  );
  updateIdvControls(form);
}

function captureIdvFace(form) {
  const state = idvWizardState.get(form);
  const video = form?.querySelector('[data-idv-video]');
  const canvas = form?.querySelector('[data-idv-canvas]');
  if (!state?.cameraReady || !video || !canvas) {
    setIdvStatus(form, 'Keep your face centered until capture is ready.');
    return;
  }

  const width = video.videoWidth || 720;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  form.querySelector('[data-image-hidden="faceImageDataUrl"]').value = dataUrl;
  form.querySelector('[data-idv-face-score]').value = String(state.latestScore || 0.9);
  renderIdvPreview(form.querySelector('[data-idv-analysis-face]'), dataUrl, 'Live face capture');
  updateIdvAnalysis(form);
  state.faceCaptured = true;
  stopIdvCamera(form);
  setIdvStep(form, 'analysis');
}

function updateIdvAnalysis(form) {
  const score = form.querySelector('[data-idv-face-score]')?.value || '0.90';
  const title = form.querySelector('[data-idv-analysis-title]');
  const copy = form.querySelector('[data-idv-analysis-copy]');
  if (title) {
    title.textContent = 'Evidence ready for lab validation';
  }
  if (copy) {
    copy.textContent = `MediaPipe detected and centered the face before capture. Readiness score: ${Math.round(Number(score) * 100)}%.`;
  }
}

function resetIdvWizard(form) {
  if (!form) {
    return;
  }

  stopIdvCamera(form);
  form.reset();
  form.querySelectorAll('[data-image-hidden], [data-idv-face-score]').forEach((input) => {
    input.value = '';
  });
  form.querySelectorAll('.idv-preview').forEach((preview) => {
    preview.innerHTML = '<span>Evidence preview</span>';
  });
  const state = idvWizardState.get(form) || {};
  idvWizardState.set(form, {
    ...state,
    stream: null,
    detector: null,
    running: false,
    cameraReady: false,
    latestScore: 0,
    faceCaptured: false
  });
  form.querySelector('[data-idv-camera-placeholder]')?.removeAttribute('hidden');
  form.querySelector('[data-idv-camera-frame]')?.classList.remove('is-ready', 'is-warning');
  setIdvStatus(form, 'Waiting for camera permission.');
  setIdvStep(form, 'document');
}

function stopIdvCamera(form) {
  if (!form) {
    return;
  }

  const state = idvWizardState.get(form);
  if (!state) {
    return;
  }

  state.running = false;
  state.cameraReady = false;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  if (state.detector) {
    state.detector.close?.();
  }
  state.stream = null;
  state.detector = null;
  const video = form.querySelector('[data-idv-video]');
  if (video) {
    video.srcObject = null;
  }
  updateIdvControls(form);
}

function renderIdvPreview(container, dataUrl, altText) {
  if (!container || !dataUrl) {
    return;
  }

  container.innerHTML = '';
  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = altText;
  container.append(image);
}

function setIdvStatus(form, message) {
  const status = form?.querySelector('[data-idv-status]');
  if (status) {
    status.textContent = message;
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function restoreDismissibleBanners() {
  document.querySelectorAll('[data-dismissible-banner]').forEach((banner) => {
    const key = `aegis.banner.${banner.dataset.dismissibleBanner}`;
    if (window.sessionStorage.getItem(key) === 'dismissed') {
      banner.hidden = true;
    }
  });
}

function dismissDashboardBanner(banner) {
  if (!banner) {
    return;
  }
  const key = `aegis.banner.${banner.dataset.dismissibleBanner}`;
  window.sessionStorage.setItem(key, 'dismissed');
  banner.hidden = true;
}

function openInviteModalFromHash() {
  const match = window.location.hash.match(/^#credential-(.+)$/);
  if (!match) {
    return;
  }

  window.setTimeout(() => {
    openAppModal(`#credential-invite-${window.CSS.escape(match[1])}`);
  }, 180);
}

function initWorkspaceTour() {
  const root = document.querySelector('[data-workspace-tour]');
  if (!root) {
    return;
  }

  const workspaceId = root.dataset.workspaceTour;
  const sessionKey = `aegis.workspaceTour.session.${workspaceId}`;
  const foreverKey = `aegis.workspaceTour.forever.${workspaceId}`;
  if (window.sessionStorage.getItem(sessionKey) || window.localStorage.getItem(foreverKey)) {
    return;
  }

  const steps = [
    {
      selector: '[data-workspace-tour]',
      title: 'Workspace setup path',
      body: 'Start here: review the four-step path, then work through people, roles, claims, and audit activity.'
    },
    {
      selector: '[data-tour-anchor="people-table"]',
      title: 'People directory',
      body: 'The original subscriber appears first. Click any row to open details or use row actions for common admin tasks.'
    },
    {
      selector: '[data-tour-anchor="add-user"]',
      title: 'Invite a user',
      body: 'Add employees, contractors, or admins. The invite defaults to seven days and generates a QR plus copyable link.'
    },
    {
      selector: '[data-tour-anchor="configure"]',
      title: 'Claims and roles',
      body: 'Use these tiles to define credential payloads, roles, and consent-scoped claims before issuing at scale.'
    },
    {
      selector: '[data-tour-anchor="audit"]',
      title: 'Wallet challenge log',
      body: 'High-assurance wallet prompts and admin actions are preserved here for audit and reporting.'
    }
  ];

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-overlay__shade"></div>
    <section class="tour-popover" role="dialog" aria-live="polite">
      <p class="eyebrow" data-tour-count></p>
      <h3 data-tour-title></h3>
      <p data-tour-body></p>
      <div class="tour-actions">
        <button class="button button--primary button--blue" type="button" data-tour-next>Next</button>
        <button class="button button--secondary button--dark-text" type="button" data-tour-session>Dismiss Session</button>
        <button class="button button--ghost" type="button" data-tour-forever>Dismiss Forever</button>
      </div>
    </section>
  `;
  document.body.append(overlay);

  let index = 0;
  let highlightedElement = null;
  const popover = overlay.querySelector('.tour-popover');

  const close = (forever = false) => {
    highlightedElement?.classList.remove('tour-highlight');
    window.sessionStorage.setItem(sessionKey, 'dismissed');
    if (forever) {
      window.localStorage.setItem(foreverKey, 'dismissed');
    }
    overlay.remove();
  };

  const render = () => {
    highlightedElement?.classList.remove('tour-highlight');
    const step = steps[index];
    const target = document.querySelector(step.selector) || root;
    highlightedElement = target;
    highlightedElement.classList.add('tour-highlight');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });

    popover.classList.add('is-moving');
    overlay.querySelector('[data-tour-count]').textContent = `Step ${index + 1} of ${steps.length}`;
    overlay.querySelector('[data-tour-title]').textContent = step.title;
    overlay.querySelector('[data-tour-body]').textContent = step.body;
    overlay.querySelector('[data-tour-next]').textContent = index === steps.length - 1 ? 'Finish' : 'Next';

    window.setTimeout(() => {
      positionTourPopover(popover, target);
      popover.classList.remove('is-moving');
    }, 150);
  };

  overlay.querySelector('[data-tour-next]').addEventListener('click', () => {
    if (index >= steps.length - 1) {
      close(false);
      return;
    }
    index += 1;
    render();
  });
  overlay.querySelector('[data-tour-session]').addEventListener('click', () => close(false));
  overlay.querySelector('[data-tour-forever]').addEventListener('click', () => close(true));

  window.setTimeout(render, 450);
}

function positionTourPopover(popover, target) {
  const viewportPadding = 32;
  const targetRect = target.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const popoverHeight = popoverRect.height || 220;
  const popoverWidth = popoverRect.width || 360;
  const belowTop = targetRect.bottom + 18;
  const aboveTop = targetRect.top - popoverHeight - 18;
  const fitsBelow = belowTop + popoverHeight <= window.innerHeight - viewportPadding;
  const rawTop = fitsBelow ? belowTop : aboveTop;
  const maxTop = Math.max(viewportPadding, window.innerHeight - popoverHeight - viewportPadding);
  const top = Math.min(maxTop, Math.max(viewportPadding, rawTop));
  const preferredLeft = targetRect.left + Math.min(24, Math.max(0, targetRect.width - popoverWidth) / 2);
  const maxLeft = Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding);
  const left = Math.min(maxLeft, Math.max(viewportPadding, preferredLeft));

  popover.style.setProperty('--tour-top', `${top}px`);
  popover.style.setProperty('--tour-left', `${left}px`);
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

function prepareCreationOptions(options) {
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64urlToBuffer(options.user.id)
    },
    excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id)
    }))
  };
}

function prepareRequestOptions(options) {
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((credential) => ({
      ...credential,
      id: base64urlToBuffer(credential.id)
    }))
  };
}

function serializePublicKeyCredential(credential) {
  const response = {
    clientDataJSON: bufferToBase64url(credential.response.clientDataJSON)
  };

  if (credential.response.attestationObject) {
    response.attestationObject = bufferToBase64url(credential.response.attestationObject);
    response.transports = credential.response.getTransports?.() || [];
  }

  if (credential.response.authenticatorData) {
    response.authenticatorData = bufferToBase64url(credential.response.authenticatorData);
    response.signature = bufferToBase64url(credential.response.signature);
    response.userHandle = credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null;
  }

  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response
  };
}

function base64urlToBuffer(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

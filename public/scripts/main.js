const output = document.querySelector('[data-demo-output]');
const videoModal = document.querySelector('[data-video-modal]');
const videoPlayer = document.querySelector('[data-video-player]');
let lastVideoTrigger = null;

const demoActions = {
  issue: {
    url: '/api/issuer/create-offer',
    method: 'POST',
    body: {
      displayName: 'Cloudstrucc Pilot User',
      email: 'pilot@cloudstrucc.com',
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

  try {
    const response = await fetch(action.url, {
      method: action.method,
      headers: action.body ? { 'Content-Type': 'application/json' } : undefined,
      body: action.body ? JSON.stringify(action.body) : undefined
    });
    const payload = await response.json();
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ error: error.message }, null, 2);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && videoModal && !videoModal.hidden) {
    closeVideoModal();
  }
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

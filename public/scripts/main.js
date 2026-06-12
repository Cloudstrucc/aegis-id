const output = document.querySelector('[data-demo-output]');

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

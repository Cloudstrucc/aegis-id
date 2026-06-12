const VerifiedIdClient = require('../../services/verified-id-client');

function createMicrosoftVerifiedIdAdapter(options = {}) {
  const client = options.client || new VerifiedIdClient(options);

  return {
    name: 'microsoft-entra-verified-id',
    createCredentialOffer(input) {
      return client.createIssuanceRequest(input);
    },
    createPresentationRequest(input) {
      return client.createPresentationRequest(input);
    }
  };
}

module.exports = { createMicrosoftVerifiedIdAdapter };

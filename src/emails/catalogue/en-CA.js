// English (Canada) message catalogue.
//
// One entry per message type, each returning the same four things from the
// same variables: a subject, the preview line clients show beside it, the
// blocks the renderer turns into both the HTML and the text part, and the SMS
// wording for the same message.
//
// A code never appears in the subject or the preview. Most consumer services
// put it there and it is genuinely convenient, but it also puts the code on a
// locked screen for anyone standing nearby, and the whole premise of this
// product is that possession of a factor means something. The reader opens
// the message.
//
// `fr-CA.js` mirrors this file key for key; a test asserts the two never
// diverge, because a half-translated catalogue fails by sending the wrong
// language rather than by throwing.

module.exports = {
  // Shared chrome, used by the renderer's footer.
  common: {
    automated: ({ brand }) => `Sent by ${brand}. This is an automated message — replies to it are not monitored.`,
    copyright: ({ year }) => `© ${year} Vanguard Cloud Services`,
    onBehalfOf: ({ brand, organizationName }) =>
      `Sent by ${brand} on behalf of ${organizationName}.`,
    support: ({ supportEmail }) => `Need help? Write to ${supportEmail}.`
  },

  messages: {
    'mfa-otp': {
      subject: ({ brand }) => `Your ${brand} sign-in code`,
      preview: () => 'A one-time code to finish signing in.',
      sms: ({ brand, code }) => `${brand} sign-in code: ${code}`,
      blocks: ({ brand, code }) => [
        { type: 'heading', text: 'Your sign-in code' },
        { type: 'text', text: `Enter this code to finish signing in to ${brand}.` },
        { type: 'code', value: code },
        { type: 'note', text: 'The code expires in 10 minutes and can only be used once.' },
        {
          type: 'warn',
          text: 'If you did not try to sign in, change your password now — somebody else '
            + 'knows it, and this code is the only thing that stopped them.'
        }
      ]
    },

    'password-reset': {
      subject: ({ brand }) => `Reset your ${brand} password`,
      preview: () => 'A link to choose a new password.',
      sms: ({ brand, resetUrl }) => `Reset your ${brand} password: ${resetUrl}`,
      blocks: ({ brand, resetUrl, expiresInMinutes }) => [
        { type: 'heading', text: 'Reset your password' },
        { type: 'text', text: `Somebody asked to reset the password on your ${brand} account.` },
        { type: 'button', label: 'Choose a new password', url: resetUrl },
        { type: 'note', text: `The link expires in ${expiresInMinutes} minutes and can only be used once.` },
        {
          type: 'note',
          text: 'If this was not you, there is nothing to do. Your password has not changed, '
            + 'and the link stops working on its own.'
        }
      ]
    },

    'email-verification': {
      subject: ({ brand }) => `Confirm your ${brand} email address`,
      preview: () => 'One step left to finish setting up the account.',
      sms: ({ brand, verifyUrl }) => `Confirm your ${brand} email: ${verifyUrl}`,
      blocks: ({ brand, verifyUrl, expiresInHours, displayName }) => [
        { type: 'heading', text: 'Confirm your email address' },
        {
          type: 'text',
          text: `${displayName ? `Hello ${displayName}. ` : ''}Confirm this address to finish `
            + `setting up your ${brand} account.`
        },
        { type: 'button', label: 'Confirm email address', url: verifyUrl },
        { type: 'note', text: `The link expires in ${expiresInHours} hours and can only be used once.` },
        { type: 'note', text: 'If you did not create an account, you can ignore this message.' }
      ]
    },

    'account-reenrolment': {
      subject: ({ brand }) => `Set up a new passkey for your ${brand} account`,
      preview: () => 'An administrator has authorised a new passkey.',
      sms: ({ brand, reenrolUrl }) => `Set up a new ${brand} passkey: ${reenrolUrl}`,
      blocks: ({ reenrolUrl, expiresInMinutes, displayName }) => [
        { type: 'heading', text: 'Register a new passkey' },
        {
          type: 'text',
          text: `${displayName ? `Hello ${displayName}. ` : ''}An administrator has authorised you `
            + 'to register a new passkey, because you no longer have your old one or any recovery codes.'
        },
        { type: 'button', label: 'Register a new passkey', url: reenrolUrl },
        { type: 'note', text: `The link expires in ${expiresInMinutes} minutes and can only be used once.` },
        {
          type: 'warn',
          text: 'If you did not ask for this, tell your administrator immediately. Somebody may be '
            + 'trying to take over your account.'
        }
      ]
    },

    'approver-recovery': {
      subject: ({ organizationName }) => `Approve a recovery for ${organizationName || 'your organization'}`,
      preview: () => 'Your root wallet is one of two needed to approve.',
      sms: ({ brand, approvalUrl, organizationName }) =>
        `Approve an ${brand} recovery for ${organizationName || 'your organization'}: ${approvalUrl}`,
      blocks: ({ brand, approvalUrl, expiresInHours, organizationName, requesterEmail }) => [
        { type: 'heading', text: 'A recovery needs your approval' },
        {
          type: 'text',
          text: `Your wallet is a root wallet of ${organizationName || `a ${brand} organization`}. `
            + `${requesterEmail || 'An administrator'} has asked to recover their access, and two `
            + 'root wallets have to approve before anything is issued.'
        },
        {
          type: 'meta',
          rows: [
            ['Organization', organizationName || '—'],
            ['Requested by', requesterEmail || 'An administrator']
          ]
        },
        { type: 'button', label: 'Open on the device holding your wallet', url: approvalUrl },
        { type: 'note', text: `The link expires in ${expiresInHours} hours and works only with your wallet.` },
        {
          type: 'warn',
          text: 'If you were not expecting this, do not approve it. Somebody may be trying to take '
            + 'over that account — tell the other root wallet holders.'
        }
      ]
    },

    'approver-recovery-status': {
      subject: ({ brand }) => `Your ${brand} recovery is waiting on your root wallets`,
      preview: () => 'The approvals have been sent to the wallet holders.',
      sms: ({ brand, statusUrl }) => `Your ${brand} recovery is waiting on root wallet approvals: ${statusUrl}`,
      blocks: ({ statusUrl, expiresInHours, organizationName, approvalsRequired }) => [
        { type: 'heading', text: 'Your recovery is under way' },
        {
          type: 'text',
          text: `You asked to recover your access to ${organizationName || 'your organization'}. `
            + `${approvalsRequired} of your organization's root wallet holders have been asked to `
            + 'approve from their own wallets.'
        },
        { type: 'button', label: 'Watch the progress', url: statusUrl },
        { type: 'note', text: `The page expires in ${expiresInHours} hours.` },
        {
          type: 'note',
          text: 'This link grants nothing on its own. The approvals went to the wallet holders, '
            + 'not to you, so if you did not ask for this there is nothing to do — nothing can be '
            + 'issued without those approvals.'
        }
      ]
    },

    'wallet-recovery': {
      subject: ({ brand }) => `Your ${brand} wallet recovery code`,
      preview: () => 'A one-time code to recover a wallet.',
      sms: ({ brand, code }) => `${brand} verification code: ${code}`,
      blocks: ({ code, walletId }) => [
        { type: 'heading', text: 'Your wallet recovery code' },
        { type: 'text', text: 'Enter this code to continue recovering your wallet.' },
        { type: 'code', value: code },
        { type: 'meta', rows: [['Wallet', walletId || '—']] },
        { type: 'note', text: 'The code expires in 10 minutes and can only be used once.' },
        {
          type: 'warn',
          text: 'If you did not ask to recover this wallet, somebody is trying to take it over. '
            + 'Tell your organization administrator immediately.'
        }
      ]
    }
  }
};

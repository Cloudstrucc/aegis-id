// Français (Canada) message catalogue.
//
// Mirrors en-CA key for key. The vouvoiement is used throughout, which is
// what a Canadian organization writing to its own staff and contractors
// expects, and the terminology follows the Office québécois de la langue
// française where it has settled on a term: « code à usage unique »,
// « clé d'accès » for a passkey, « portefeuille » for a wallet.
//
// Not a transliteration of the English. "Somebody else knows it, and this
// code is the only thing that stopped them" is a sentence that only works in
// English; the French says the same thing in its own shape.
//
// Typography is French: a narrow no-break space before : ; ! ? and inside
// « guillemets ». Written as U+202F so it cannot wrap away from its
// punctuation.

const NB = ' '; // narrow no-break space

module.exports = {
  common: {
    automated: ({ brand }) =>
      `Envoyé par ${brand}. Ce message est automatique${NB}; les réponses ne sont pas lues.`,
    copyright: ({ year }) => `© ${year} Vanguard Cloud Services`,
    onBehalfOf: ({ brand, organizationName }) =>
      `Envoyé par ${brand} pour le compte de ${organizationName}.`,
    support: ({ supportEmail }) => `Besoin d'aide${NB}? Écrivez à ${supportEmail}.`
  },

  messages: {
    'mfa-otp': {
      subject: ({ brand }) => `Votre code de connexion ${brand}`,
      preview: () => 'Un code à usage unique pour terminer la connexion.',
      sms: ({ brand, code }) => `Code de connexion ${brand}${NB}: ${code}`,
      blocks: ({ brand, code }) => [
        { type: 'heading', text: 'Votre code de connexion' },
        { type: 'text', text: `Saisissez ce code pour terminer votre connexion à ${brand}.` },
        { type: 'code', value: code },
        {
          type: 'note',
          text: `Le code expire dans 10 minutes et ne peut servir qu'une seule fois.`
        },
        {
          type: 'warn',
          text: `Si vous n'avez pas tenté de vous connecter, changez votre mot de passe `
            + `immédiatement${NB}: quelqu'un d'autre le connaît, et seul ce code l'a arrêté.`
        }
      ]
    },

    'password-reset': {
      subject: ({ brand }) => `Réinitialiser votre mot de passe ${brand}`,
      preview: () => 'Un lien pour choisir un nouveau mot de passe.',
      sms: ({ brand, resetUrl }) => `Réinitialiser votre mot de passe ${brand}${NB}: ${resetUrl}`,
      blocks: ({ brand, resetUrl, expiresInMinutes }) => [
        { type: 'heading', text: 'Réinitialiser votre mot de passe' },
        {
          type: 'text',
          text: `Quelqu'un a demandé la réinitialisation du mot de passe de votre compte ${brand}.`
        },
        { type: 'button', label: 'Choisir un nouveau mot de passe', url: resetUrl },
        {
          type: 'note',
          text: `Le lien expire dans ${expiresInMinutes} minutes et ne peut servir qu'une seule fois.`
        },
        {
          type: 'note',
          text: `Si ce n'était pas vous, il n'y a rien à faire. Votre mot de passe n'a pas changé `
            + `et le lien cessera de fonctionner de lui-même.`
        }
      ]
    },

    'email-verification': {
      subject: ({ brand }) => `Confirmez votre adresse courriel ${brand}`,
      preview: () => 'Une dernière étape pour terminer la création du compte.',
      sms: ({ brand, verifyUrl }) => `Confirmez votre courriel ${brand}${NB}: ${verifyUrl}`,
      blocks: ({ brand, verifyUrl, expiresInHours, displayName }) => [
        { type: 'heading', text: 'Confirmez votre adresse courriel' },
        {
          type: 'text',
          text: `${displayName ? `Bonjour ${displayName}. ` : ''}Confirmez cette adresse pour `
            + `terminer la création de votre compte ${brand}.`
        },
        { type: 'button', label: `Confirmer l'adresse courriel`, url: verifyUrl },
        {
          type: 'note',
          text: `Le lien expire dans ${expiresInHours} heures et ne peut servir qu'une seule fois.`
        },
        {
          type: 'note',
          text: `Si vous n'avez pas créé de compte, vous pouvez ignorer ce message.`
        }
      ]
    },

    'account-reenrolment': {
      subject: ({ brand }) => `Configurez une nouvelle clé d'accès pour votre compte ${brand}`,
      preview: () => `Un administrateur a autorisé une nouvelle clé d'accès.`,
      sms: ({ brand, reenrolUrl }) => `Nouvelle clé d'accès ${brand}${NB}: ${reenrolUrl}`,
      blocks: ({ reenrolUrl, expiresInMinutes, displayName }) => [
        { type: 'heading', text: `Enregistrer une nouvelle clé d'accès` },
        {
          type: 'text',
          text: `${displayName ? `Bonjour ${displayName}. ` : ''}Un administrateur vous a autorisé `
            + `à enregistrer une nouvelle clé d'accès, car vous n'avez plus l'ancienne ni de code `
            + `de récupération.`
        },
        { type: 'button', label: `Enregistrer une clé d'accès`, url: reenrolUrl },
        {
          type: 'note',
          text: `Le lien expire dans ${expiresInMinutes} minutes et ne peut servir qu'une seule fois.`
        },
        {
          type: 'warn',
          text: `Si vous n'avez rien demandé, prévenez immédiatement votre administrateur. `
            + `Quelqu'un tente peut-être de prendre le contrôle de votre compte.`
        }
      ]
    },

    'approver-recovery': {
      subject: ({ organizationName }) =>
        `Approuver une récupération pour ${organizationName || 'votre organisation'}`,
      preview: () => `Votre portefeuille racine est l'un des deux requis.`,
      sms: ({ brand, approvalUrl, organizationName }) =>
        `Approuver une récupération ${brand} pour ${organizationName || 'votre organisation'}${NB}: ${approvalUrl}`,
      blocks: ({ brand, approvalUrl, expiresInHours, organizationName, requesterEmail }) => [
        { type: 'heading', text: 'Une récupération attend votre approbation' },
        {
          type: 'text',
          text: `Votre portefeuille est un portefeuille racine de `
            + `${organizationName || `une organisation ${brand}`}. `
            + `${requesterEmail || 'Un administrateur'} a demandé à récupérer son accès, et deux `
            + `portefeuilles racines doivent approuver avant que quoi que ce soit ne soit émis.`
        },
        {
          type: 'meta',
          rows: [
            ['Organisation', organizationName || '—'],
            ['Demandé par', requesterEmail || 'Un administrateur']
          ]
        },
        { type: 'button', label: `Ouvrir sur l'appareil qui détient votre portefeuille`, url: approvalUrl },
        {
          type: 'note',
          text: `Le lien expire dans ${expiresInHours} heures et ne fonctionne qu'avec votre portefeuille.`
        },
        {
          type: 'warn',
          text: `Si vous ne vous y attendiez pas, n'approuvez rien. Quelqu'un tente peut-être de `
            + `prendre le contrôle de ce compte${NB}: prévenez les autres détenteurs de `
            + `portefeuilles racines.`
        }
      ]
    },

    'approver-recovery-status': {
      subject: ({ brand }) =>
        `Votre récupération ${brand} attend vos portefeuilles racines`,
      preview: () => 'Les approbations ont été envoyées aux détenteurs.',
      sms: ({ brand, statusUrl }) =>
        `Votre récupération ${brand} attend des approbations${NB}: ${statusUrl}`,
      blocks: ({ statusUrl, expiresInHours, organizationName, approvalsRequired }) => [
        { type: 'heading', text: 'Votre récupération est en cours' },
        {
          type: 'text',
          text: `Vous avez demandé à récupérer votre accès à `
            + `${organizationName || 'votre organisation'}. ${approvalsRequired} détenteurs de `
            + `portefeuilles racines de votre organisation ont été invités à approuver depuis `
            + `leur propre portefeuille.`
        },
        { type: 'button', label: `Suivre l'avancement`, url: statusUrl },
        { type: 'note', text: `La page expire dans ${expiresInHours} heures.` },
        {
          type: 'note',
          text: `Ce lien n'accorde rien par lui-même. Les approbations ont été envoyées aux `
            + `détenteurs des portefeuilles, pas à vous${NB}: si vous n'avez rien demandé, il n'y `
            + `a rien à faire, car rien ne peut être émis sans ces approbations.`
        }
      ]
    },

    'wallet-recovery': {
      subject: ({ brand }) => `Votre code de récupération de portefeuille ${brand}`,
      preview: () => 'Un code à usage unique pour récupérer un portefeuille.',
      sms: ({ brand, code }) => `Code de vérification ${brand}${NB}: ${code}`,
      blocks: ({ code, walletId }) => [
        { type: 'heading', text: 'Votre code de récupération de portefeuille' },
        { type: 'text', text: 'Saisissez ce code pour poursuivre la récupération de votre portefeuille.' },
        { type: 'code', value: code },
        { type: 'meta', rows: [['Portefeuille', walletId || '—']] },
        {
          type: 'note',
          text: `Le code expire dans 10 minutes et ne peut servir qu'une seule fois.`
        },
        {
          type: 'warn',
          text: `Si vous n'avez pas demandé cette récupération, quelqu'un tente de s'emparer de ce `
            + `portefeuille. Prévenez immédiatement l'administrateur de votre organisation.`
        }
      ]
    }
  }
};

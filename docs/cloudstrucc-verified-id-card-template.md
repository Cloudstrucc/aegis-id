# Cloudstrucc Verified ID Card Template

Use this card style for the Microsoft Entra Verified ID `VerifiedEmployee` pilot.

## Portal Card Style Values

Paste these values into **Microsoft Entra admin center > Verified ID > Credentials > Card style**.

| Field | Value |
| --- | --- |
| Issuer | `Cloudstrucc inc.` |
| Logo URL | `https://vanguard-aegis-id-65067d.azurewebsites.net/images/cloudstrucc-verified-id-logo-mark.png` |
| Text color | `#FFFFFF` |
| Background color | `#071A2E` |

## Alternative Brighter Card

Use this if the default card feels too dark in Microsoft Authenticator.

| Field | Value |
| --- | --- |
| Text color | `#FFFFFF` |
| Background color | `#0B3A73` |

## Display Definition Example

For a custom credential contract, use this display definition as the starting point.

```json
{
  "locale": "en-US",
  "card": {
    "title": "Verified Employee",
    "issuedBy": "Cloudstrucc inc.",
    "backgroundColor": "#071A2E",
    "textColor": "#FFFFFF",
    "logo": {
      "uri": "https://vanguard-aegis-id-65067d.azurewebsites.net/images/cloudstrucc-verified-id-logo-mark.png",
      "description": "Cloudstrucc Verified ID cloud logo"
    },
    "description": "Use this credential to prove Cloudstrucc workforce eligibility."
  },
  "consent": {
    "title": "Add your Cloudstrucc Verified Employee credential?",
    "instructions": "Review the issuer and claims before adding this credential to your wallet."
  },
  "claims": [
    {
      "claim": "vc.credentialSubject.displayName",
      "label": "Display name",
      "type": "String"
    },
    {
      "claim": "vc.credentialSubject.mail",
      "label": "Email",
      "type": "String"
    },
    {
      "claim": "vc.credentialSubject.jobTitle",
      "label": "Job title",
      "type": "String"
    },
    {
      "claim": "vc.credentialSubject.department",
      "label": "Department",
      "type": "String"
    }
  ]
}
```

## Notes

- The logo URL must be publicly reachable over HTTPS.
- The app serves `/images/*` with `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *` so Microsoft Entra can render the preview.
- Microsoft recommends widely supported image formats such as PNG, JPG, or BMP.
- The recommended PNG is 100 x 100 with a transparent background so it behaves like a compact wallet card logo.
- The recommended asset uses only the Cloudstrucc mark because the card already shows `Cloudstrucc inc.` as issuer text.
- A full lockup variant is available at `/images/cloudstrucc-verified-id-logo-lockup.png`, but the wordmark is small in the wallet card logo slot.
- A larger app-icon-style variant is also available at `/images/cloudstrucc-verified-id-logo.png`, but it is not recommended for the Microsoft card logo slot.
- After deploying, verify the logo URL returns `image/png` before saving the card style.

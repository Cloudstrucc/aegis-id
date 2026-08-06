// Step-by-step TXT record instructions, per DNS provider.
//
// Kept as data rather than prose in a template because the differences between
// providers are small but maddening, and they are what actually cost people an
// afternoon: whether the host field wants the full name or just the label,
// where the TTL lives, and what the provider calls the button.
//
// The one that catches almost everybody is the host field. Most providers
// append the domain for you, so typing `_aegis-challenge.contoso.com` creates
// `_aegis-challenge.contoso.com.contoso.com`, which resolves to nothing and
// looks exactly like "it just did not work".

const DNS_PROVIDERS = Object.freeze([
  {
    id: 'godaddy',
    name: 'GoDaddy',
    hostFieldName: 'Name',
    hostFieldExpects: 'label-only',
    steps: [
      'Sign in and open <strong>My Products</strong>, then <strong>DNS</strong> beside the domain.',
      'Select <strong>Add New Record</strong> and choose type <strong>TXT</strong>.',
      'In <strong>Name</strong>, enter just <code>_aegis-challenge</code> — GoDaddy adds your domain automatically.',
      'Paste the value into <strong>Value</strong>.',
      'Leave <strong>TTL</strong> on <em>1 hour</em> (or set <em>Custom</em> → 600 to see it sooner).',
      'Select <strong>Save</strong>, then come back here and choose <strong>Check DNS now</strong>.'
    ]
  },
  {
    id: 'namecheap',
    name: 'Namecheap',
    hostFieldName: 'Host',
    hostFieldExpects: 'label-only',
    steps: [
      'Sign in, open <strong>Domain List</strong> and select <strong>Manage</strong> beside the domain.',
      'Open the <strong>Advanced DNS</strong> tab.',
      'Select <strong>Add New Record</strong> → <strong>TXT Record</strong>.',
      'In <strong>Host</strong>, enter <code>_aegis-challenge</code> only.',
      'Paste the value into <strong>Value</strong> and leave <strong>TTL</strong> on <em>Automatic</em>.',
      'Select the green tick to save, then choose <strong>Check DNS now</strong> here.'
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    hostFieldName: 'Name',
    hostFieldExpects: 'label-only',
    steps: [
      'Sign in, select the domain, then open <strong>DNS</strong> → <strong>Records</strong>.',
      'Select <strong>Add record</strong> and set <strong>Type</strong> to <strong>TXT</strong>.',
      'In <strong>Name</strong>, enter <code>_aegis-challenge</code>.',
      'Paste the value into <strong>Content</strong>.',
      'Leave <strong>TTL</strong> on <em>Auto</em>. Proxy status does not apply to TXT records.',
      'Select <strong>Save</strong>. Cloudflare usually publishes within a minute.'
    ]
  },
  {
    id: 'squarespace',
    name: 'Squarespace Domains (formerly Google Domains)',
    hostFieldName: 'Host',
    hostFieldExpects: 'label-only',
    steps: [
      'Sign in and open <strong>Domains</strong>, then select the domain.',
      'Open <strong>DNS</strong> → <strong>DNS Settings</strong> and find <strong>Custom records</strong>.',
      'Select <strong>Add record</strong> and choose <strong>TXT</strong>.',
      'In <strong>Host</strong>, enter <code>_aegis-challenge</code>.',
      'Paste the value into <strong>Data</strong> and leave <strong>TTL</strong> at the default.',
      'Select <strong>Save</strong>, then choose <strong>Check DNS now</strong> here.'
    ]
  },
  {
    id: 'azure',
    name: 'Azure DNS',
    hostFieldName: 'Name',
    hostFieldExpects: 'label-only',
    steps: [
      'In the Azure portal, open the <strong>DNS zone</strong> for your domain.',
      'Select <strong>+ Record set</strong>.',
      'Set <strong>Name</strong> to <code>_aegis-challenge</code> and <strong>Type</strong> to <strong>TXT</strong>.',
      'Paste the value into <strong>Value</strong>.',
      'Set <strong>TTL</strong> to <em>10</em> minutes while you are testing.',
      'Select <strong>OK</strong>. From the CLI this is one command — see below.'
    ],
    cli: 'az network dns record-set txt add-record \\\n  --resource-group <your-rg> \\\n  --zone-name <your-domain> \\\n  --record-set-name _aegis-challenge \\\n  --value "<paste the value here>"'
  },
  {
    id: 'route53',
    name: 'AWS Route 53',
    hostFieldName: 'Record name',
    hostFieldExpects: 'full-name',
    steps: [
      'Open the Route 53 console and select <strong>Hosted zones</strong>, then your domain.',
      'Select <strong>Create record</strong>.',
      'In <strong>Record name</strong>, enter <code>_aegis-challenge</code> — Route 53 shows your domain beside the box, so the result is the full name.',
      'Set <strong>Record type</strong> to <strong>TXT</strong>.',
      'Paste the value into <strong>Value</strong>, <em>wrapped in double quotes</em>. Route 53 is one of the few that requires this.',
      'Set <strong>TTL</strong> to <em>300</em> and select <strong>Create records</strong>.'
    ],
    cli: 'aws route53 change-resource-record-sets \\\n  --hosted-zone-id <ZONEID> \\\n  --change-batch \'{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"_aegis-challenge.<your-domain>","Type":"TXT","TTL":300,"ResourceRecords":[{"Value":"\\"<paste the value here>\\""}]}}]}\''
  }
]);

module.exports = { DNS_PROVIDERS };

import SwiftUI

// The extension's interface.
//
// Deliberately small: this appears in a sheet the system sizes, over whatever
// the holder was doing, and the only question is whether to go ahead. Anything
// more would be a second product surface to keep in step with the app.

struct PasskeyPromptView: View {
    let title: String
    let relyingParty: String
    let account: String
    let actionTitle: String
    let explanation: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PasskeyHeader(title: title, relyingParty: relyingParty)

            if !account.isEmpty {
                LabelledRow(label: "Account", value: account)
            }

            Text(explanation)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                Button(action: onConfirm) {
                    Text(actionTitle)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)

                Button("Not now", action: onCancel)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(22)
    }
}

struct PasskeyChooserView: View {
    let relyingParty: String
    let passkeys: [StoredPasskey]
    let onSelect: (StoredPasskey) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PasskeyHeader(title: "Choose an account", relyingParty: relyingParty)

            List(passkeys) { passkey in
                Button {
                    onSelect(passkey)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(passkey.accountLabel).font(.body.weight(.semibold))
                        if let used = passkey.lastUsedAt {
                            Text("Last used \(used.formatted(date: .abbreviated, time: .omitted))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Not used yet").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listStyle(.plain)

            Button("Cancel", action: onCancel)
                .frame(maxWidth: .infinity)
        }
        .padding(22)
    }
}

struct PasskeyEmptyView: View {
    let relyingParty: String
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PasskeyHeader(title: "No passkey here", relyingParty: relyingParty)

            Text(
                "This wallet holds no passkey for that site. Create one from the site itself and choose Aegis ID when asked where to save it."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Button("Close", action: onCancel)
                .frame(maxWidth: .infinity)
                .buttonStyle(.bordered)
        }
        .padding(22)
    }
}

private struct PasskeyHeader: View {
    let title: String
    let relyingParty: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Aegis ID")
                .font(.caption.weight(.heavy))
                .foregroundStyle(.tint)
            Text(title).font(.title2.weight(.bold))
            Text(relyingParty)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct LabelledRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.semibold)
        }
        .font(.subheadline)
        .padding(12)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Shown while the extension works.
///
/// No button. The system sheet already collected the holder's choice of
/// provider, and the biometric prompt collects the rest — anything in between
/// is a tap that spends the relying party's timeout without deciding anything.
struct PasskeyWorkingView: View {
    let title: String
    let relyingParty: String

    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text(title).font(.headline)
            Text(relyingParty).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(22)
    }
}

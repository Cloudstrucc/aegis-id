import SwiftUI

/// The passkeys this wallet holds for other people's services.
///
/// Deliberately separate from the wallet's own passkey settings, which are
/// about approving Aegis challenges. These are FIDO2 credentials for any site
/// that supports them, and the wallet is only their storage — it cannot tell a
/// site anything about them, including that one has been deleted here.
struct PasskeysView: View {
    @State private var passkeys: [StoredPasskey] = []
    @State private var providerEnabled = false
    @State private var pendingDeletion: StoredPasskey?

    private let store = PasskeyStore.shared

    var body: some View {
        List {
            if !providerEnabled {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Turn Aegis ID on as a passkey provider")
                            .font(.subheadline.weight(.semibold))
                        Text(
                            "Settings › General › AutoFill & Passwords, then switch on Aegis ID. Until then iOS will not offer this wallet when a site asks for a passkey."
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .font(.caption.weight(.semibold))
                    }
                    .padding(.vertical, 4)
                }
            }

            if passkeys.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No passkeys yet").font(.subheadline.weight(.semibold))
                        Text(
                            "Create one from the site itself — on this device — and choose Aegis ID when asked where to save it. Passkeys created here work on this device only."
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                ForEach(groupedByRelyingParty, id: \.0) { relyingParty, records in
                    Section(relyingParty) {
                        ForEach(records) { passkey in
                            PasskeyRow(passkey: passkey)
                                .swipeActions {
                                    Button("Delete", role: .destructive) {
                                        pendingDeletion = passkey
                                    }
                                }
                        }
                    }
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Same device only").font(.caption.weight(.bold))
                    Text(
                        "These passkeys answer sign-in requests on this phone. Signing in on a computer by scanning a code uses a transport the operating system reserves for itself, so no third-party wallet can offer it."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Passkeys")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .refreshable { await reload() }
        .confirmationDialog(
            "Delete this passkey?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let passkey = pendingDeletion {
                    store.delete(credentialId: passkey.credentialId)
                    pendingDeletion = nil
                    Task { await reload() }
                }
            }
            Button("Keep", role: .cancel) { pendingDeletion = nil }
        } message: {
            Text(
                "The key is erased from this device and cannot be recovered. The site will still list it until you remove it there too, and sign-in with it will simply stop working."
            )
        }
    }

    private var groupedByRelyingParty: [(String, [StoredPasskey])] {
        Dictionary(grouping: passkeys, by: \.rpId)
            .map { ($0.key, $0.value.sorted { $0.createdAt > $1.createdAt }) }
            .sorted { $0.0 < $1.0 }
    }

    private func reload() async {
        passkeys = store.all()
        providerEnabled = await PasskeyIdentityIndex.isProviderEnabled()
        // The system's suggestion list drifts if a passkey was deleted while
        // the provider was switched off, so put it back in step on every visit.
        await PasskeyIdentityIndex.refresh()
    }
}

private struct PasskeyRow: View {
    let passkey: StoredPasskey

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(passkey.accountLabel).font(.subheadline.weight(.semibold))
            HStack(spacing: 10) {
                Label(created, systemImage: "calendar")
                if let used = passkey.lastUsedAt {
                    Label(used.formatted(date: .abbreviated, time: .omitted), systemImage: "clock")
                } else {
                    Label("Never used", systemImage: "clock")
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var created: String {
        passkey.createdAt.formatted(date: .abbreviated, time: .omitted)
    }
}

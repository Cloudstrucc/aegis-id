import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var passkeySubject = ""
    @State private var isRegisteringPasskey = false

    var body: some View {
        List {
            Section("Profile") {
                LabeledContent("Organization", value: "Vanguard Cloud Services")
                LabeledContent("Wallet", value: "Aegis ID Wallet")
                LabeledContent("Mode", value: "Aries lab")
                LabeledContent("Website", value: "vanguardcs.ca")
            }

            Section("Aegis ID service") {
                LabeledContent("Web app", value: AegisWalletEnvironment.webAppDisplayValue)
                LabeledContent("Lab transport", value: AegisWalletEnvironment.usesHostedWebApp ? "Hosted bridge" : "Local ACA-Py")
            }

            Section("Local ACA-Py fallback") {
                LabeledContent("Holder admin", value: AegisWalletEnvironment.holderAdminURL.hostPortDisplay)
                LabeledContent("Issuer admin", value: AegisWalletEnvironment.issuerAdminURL.hostPortDisplay)
                LabeledContent("Verifier admin", value: AegisWalletEnvironment.verifierAdminURL.hostPortDisplay)
                LabeledContent("Mediator admin", value: AegisWalletEnvironment.mediatorAdminURL.hostPortDisplay)
            }

            Section("Protocol") {
                LabeledContent("Invitation", value: "Out-of-Band 1.1")
                LabeledContent("Handshake", value: "DIDExchange 1.0")
                LabeledContent("Credential engine", value: "Lab bridge")
            }

            Section("Wallet passkey assurance") {
                TextField("Wallet subject email", text: $passkeySubject)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .onSubmit {
                        store.updateWalletPasskeySubject(passkeySubject)
                    }

                LabeledContent("Registered passkeys", value: "\(store.walletPasskeyStatus?.passkeyCount ?? 0)")
                if let lastUsed = store.walletPasskeyStatus?.lastAuthenticatedAt {
                    LabeledContent("Last verified", value: lastUsed)
                }

                Button {
                    isRegisteringPasskey = true
                    Task {
                        store.updateWalletPasskeySubject(passkeySubject)
                        await store.registerWalletPasskey()
                        await store.refreshWalletPasskeyStatus()
                        isRegisteringPasskey = false
                    }
                } label: {
                    Label(isRegisteringPasskey ? "Registering..." : "Register Wallet Passkey", systemImage: "person.badge.key")
                }
                .disabled(isRegisteringPasskey || passkeySubject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    store.updateWalletPasskeySubject(passkeySubject)
                    Task { await store.refreshWalletPasskeyStatus() }
                } label: {
                    Label("Refresh Passkey Status", systemImage: "arrow.clockwise")
                }

                Text("When an organization requires passkey-backed wallet approvals, this wallet verifies the passkey before accepting the Aegis challenge.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Simulator lab mode") {
                Text(AegisWalletEnvironment.usesHostedWebApp ? "This app sends lab actions to the hosted Aegis ID bridge, which talks to ACA-Py with server-side admin credentials. It is not a production wallet engine and should not be used with real credentials." : "This app calls local ACA-Py admin APIs for simulator-only testing. It is not a production wallet engine and should not be used with real credentials.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            passkeySubject = store.walletPasskeySubject
            Task { await store.refreshWalletPasskeyStatus() }
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(WalletStore())
    }
}

private extension URL {
    var hostPortDisplay: String {
        guard let host = host() else {
            return absoluteString
        }

        if let port = port {
            return "\(host):\(port)"
        }

        return host
    }
}

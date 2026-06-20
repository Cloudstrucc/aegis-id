import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: WalletStore
    @State private var passkeySubject = ""
    @State private var isRegisteringPasskey = false
    @State private var passkeyPreference: WalletPasskeyCredentialPreference = .securityKey

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

                Toggle("Require passkey before wallet challenge approvals", isOn: Binding(
                    get: { store.requirePasskeyForAllWalletChallenges },
                    set: { store.updateRequirePasskeyForAllWalletChallenges($0) }
                ))

                Picker("Register using", selection: $passkeyPreference) {
                    ForEach(WalletPasskeyCredentialPreference.allCases) { preference in
                        Text(preference.title).tag(preference)
                    }
                }
                .pickerStyle(.segmented)

                Button {
                    isRegisteringPasskey = true
                    Task {
                        defer { isRegisteringPasskey = false }
                        store.updateWalletPasskeySubject(passkeySubject)
                        let registered = await store.registerWalletPasskey(preference: passkeyPreference)
                        if registered {
                            await store.refreshWalletPasskeyStatus()
                        }
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

                Text("Register Apple Passwords, a browser passkey, or a hardware security key such as YubiKey. The local toggle is useful for demos; organization policy can still require server-verified passkey evidence.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let message = store.lastLabMessage {
                    Text(message)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(VanguardTheme.green)
                        .textSelection(.enabled)
                }

                if let error = store.lastLabError {
                    Text(error)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
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

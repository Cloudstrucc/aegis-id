import SwiftUI

private enum SettingsRoute: Hashable {
    case connections
    case profile
    case passkeys
}

struct SettingsView: View {
    @EnvironmentObject private var store: WalletStore
    @EnvironmentObject private var router: AppRouter

    /// Path-driven for the same reason Organizations is: the Home screen can
    /// send somebody straight to Connections, which lives in here rather than
    /// on a tab of its own.
    @State private var path: [SettingsRoute] = []
    @State private var passkeySubject = ""
    @State private var isRegisteringPasskey = false
    @State private var passkeyPreference: WalletPasskeyCredentialPreference = .securityKey
    @State private var showHelp = false
    @State private var showWebApp = false

    var body: some View {
        NavigationStack(path: $path) {
        List {
            // First, above the wallet itself. Everything below assumes the
            // holder already knows what this app is for; this is where they
            // find out, or come back when a second organization invites them.
            Section("Getting started") {
                Button {
                    showHelp = true
                } label: {
                    Label("How to set up and use this wallet", systemImage: "questionmark.circle")
                }

                Button {
                    showWebApp = true
                } label: {
                    Label("Open the web app", systemImage: "safari")
                }
            }

            Section("My wallet") {
                NavigationLink(value: SettingsRoute.profile) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(store.identity?.walletId ?? "Not registered")
                            .font(.system(.subheadline, design: .monospaced).bold())
                        Text(store.identity?.email ?? "Set up your wallet")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Connections") {
                NavigationLink(value: SettingsRoute.connections) {
                    LabeledContent("Connections", value: "\(store.connections.count)")
                }
            }

            // Passkeys this wallet holds for other people's sites, as opposed
            // to the wallet's own passkey settings further down, which are
            // about approving Aegis challenges.
            //
            // Hidden while the provider is not embedded: a screen offering to
            // manage passkeys iOS will never route to this app is a promise the
            // build cannot keep.
            if AegisWalletEnvironment.providesPasskeysForOtherServices {
                Section("Passkeys for other services") {
                    NavigationLink(value: SettingsRoute.passkeys) {
                        LabeledContent("Saved passkeys", value: "\(PasskeyStore.shared.all().count)")
                    }
                }
            }

            Section("Aegis ID service") {
                Button {
                    showWebApp = true
                } label: {
                    LabeledContent("Web app", value: AegisWalletEnvironment.webAppDisplayValue)
                }
                .buttonStyle(.plain)
                LabeledContent("Lab transport", value: AegisWalletEnvironment.usesHostedWebApp ? "Hosted bridge" : "Local ACA-Py")
            }

            Section("Local ACA-Py fallback") {
                LabeledContent("Holder admin", value: AegisWalletEnvironment.holderAdminURL.hostPortDisplay)
                LabeledContent("Issuer admin", value: AegisWalletEnvironment.issuerAdminURL.hostPortDisplay)
                LabeledContent("Verifier admin", value: AegisWalletEnvironment.verifierAdminURL.hostPortDisplay)
                LabeledContent("Mediator admin", value: AegisWalletEnvironment.mediatorAdminURL.hostPortDisplay)
            }

            Section {
                LabeledContent("Credentials", value: "Aegis ID service")
                LabeledContent("Invitations", value: "aegisid:// deep links")
                LabeledContent("Challenges", value: "Polled from the Aegis ID service")
            } header: {
                Text("Protocol")
            } footer: {
                Text("Organization and credential invitations are handled by the Aegis ID service directly. The Aries protocols below apply only to lab connections.")
            }

            Section("Aries lab protocol") {
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
        .navigationDestination(for: SettingsRoute.self) { route in
            switch route {
            case .connections: ConnectionsView()
            case .profile: WalletProfileView()
            case .passkeys: PasskeysView()
            }
        }
        }
        .onChange(of: router.wantsConnections) { _, _ in
            openConnectionsIfRequested()
        }
        .onAppear {
            openConnectionsIfRequested()
        }
        .sheet(isPresented: $showHelp) {
            WalletHelpView()
        }
        .sheet(isPresented: $showWebApp) {
            SafariView(url: AegisWalletEnvironment.webAppURL).ignoresSafeArea()
        }
        .onAppear {
            passkeySubject = store.walletPasskeySubject
            Task { await store.refreshWalletPasskeyStatus() }
        }
    }

    private func openConnectionsIfRequested() {
        guard router.consumeConnections() else { return }
        path = [.connections]
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(WalletStore())
            .environmentObject(AppRouter())
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

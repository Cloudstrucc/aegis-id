import SwiftUI

// First-run setup. The wallet is unusable until the holder registers, because
// every credential invitation now binds to a Wallet ID (or to the contact
// registered here). Existing installs that predate the Wallet ID are routed
// through this same flow on next launch.
struct WalletSetupView: View {
    @EnvironmentObject private var store: WalletStore

    enum Step {
        case welcome
        case contact
        case registering
        case walletId
        case recoveryCodes
    }

    @State private var step: Step = .welcome
    @State private var email = ""
    @State private var phone = ""
    @State private var errorMessage: String?
    @State private var savedCodesConfirmed = false
    @State private var showRecovery = false
    @State private var showWebApp = false
    @State private var showHelp = false

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .welcome: welcomeStep
                case .contact: contactStep
                case .registering: registeringStep
                case .walletId: walletIdStep
                case .recoveryCodes: recoveryCodesStep
                }
            }
            .padding(24)
            .navigationTitle("Set up your wallet")
            .navigationBarTitleDisplayMode(.inline)
            // On every step, not only the welcome. Somebody who installed the
            // wallet before hearing of Aegis ID reaches the contact form still
            // wondering what they are registering with.
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    WalletHelpButton(tabsAvailable: false)
                }
            }
        }
        .sheet(isPresented: $showRecovery) {
            WalletRecoveryView().environmentObject(store)
        }
        .sheet(isPresented: $showWebApp) {
            SafariView(url: AegisWalletEnvironment.webAppURL).ignoresSafeArea()
        }
        .sheet(isPresented: $showHelp) {
            WalletHelpView(tabsAvailable: false)
        }
    }

    private var welcomeStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Vanguard Aegis ID")
                .font(.largeTitle.bold())
            if store.walletServerMismatch {
                // Explain rather than silently restarting setup.
                Label(
                    "This wallet is no longer registered on the server, so it needs to be set up again. Recover it if you have your recovery codes.",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.footnote)
                .foregroundStyle(.orange)
            }
            Text("Your wallet holds the credentials your organizations issue to you. Set it up once and you will receive a Wallet ID to share with your administrators.")
                .foregroundStyle(.secondary)

            serviceCard

            // Three lines, because the full guide is a tap away and a wall of
            // text on the first screen is a wall of text nobody reads.
            VStack(alignment: .leading, spacing: 7) {
                SetupHint(number: "1", text: "Register below and save your recovery codes.")
                SetupHint(number: "2", text: "Redeem an invitation — scan its QR on the Scan tab, or paste the link on the Home tab.")
                SetupHint(number: "3", text: "Redeem another whenever a second organization invites you. One wallet holds them all.")
            }

            Button("How this works") { showHelp = true }
                .font(.footnote.weight(.semibold))

            Spacer()
            Button("Get started") { step = .contact }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            Button("Recover an existing wallet") { showRecovery = true }
                .frame(maxWidth: .infinity)
        }
    }

    /// Where the other half of the product lives.
    ///
    /// The App Store is the one way in that does not begin with an invitation,
    /// so this is the first screen a holder can arrive at knowing nothing —
    /// including the address of the service they are registering against.
    private var serviceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("AEGIS ID SERVICE")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white.opacity(0.7))

            Text(AegisWalletEnvironment.webAppDisplayValue)
                .font(.system(.subheadline, design: .monospaced).bold())
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .lineLimit(2)
                .minimumScaleFactor(0.6)

            Button {
                showWebApp = true
            } label: {
                Label("Open the web app", systemImage: "safari")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.white)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [VanguardTheme.navy, VanguardTheme.blue],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var contactStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("How can organizations reach you?")
                .font(.title2.bold())
            Text("Your email is required. A mobile number is optional, but an organization can only send you an SMS invitation if it is on file.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("Email address", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            TextField("Mobile number (optional)", text: $phone)
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
                .textFieldStyle(.roundedBorder)

            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }

            Spacer()
            Button("Create my wallet") { register() }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                .disabled(!email.contains("@"))
        }
    }

    private var registeringStep: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Creating your wallet…").foregroundStyle(.secondary)
        }
    }

    private var walletIdStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your Wallet ID").font(.title2.bold())
            Text("Share this with an organization administrator so they can issue credentials to this wallet.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Text(store.walletId ?? "")
                .font(.system(.title3, design: .monospaced).bold())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))

            Button {
                UIPasteboard.general.string = store.walletId
            } label: {
                Label("Copy Wallet ID", systemImage: "doc.on.doc")
            }

            Spacer()
            Button("Continue") { step = .recoveryCodes }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
        }
    }

    private var recoveryCodesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Save your recovery codes").font(.title2.bold())
            Text("If you lose this device these codes let you recover your wallet. Each one works once. Store them somewhere safe — they are shown only now.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(store.pendingRecoveryCodes, id: \.self) { code in
                        Text(code).font(.system(.body, design: .monospaced))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
            .frame(maxHeight: 260)

            Button {
                UIPasteboard.general.string = store.pendingRecoveryCodes.joined(separator: "\n")
            } label: {
                Label("Copy all codes", systemImage: "doc.on.doc")
            }

            Toggle("I have saved these codes", isOn: $savedCodesConfirmed)

            Button("Finish setup") { store.completeSetup() }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                .disabled(!savedCodesConfirmed)
        }
    }

    private struct SetupHint: View {
        var number: String
        var text: String

        var body: some View {
            HStack(alignment: .top, spacing: 9) {
                Text(number)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 18, height: 18)
                    .background(VanguardTheme.blue, in: Circle())
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func register() {
        errorMessage = nil
        step = .registering
        Task {
            do {
                try await store.registerWallet(email: email, phone: phone.isEmpty ? nil : phone)
                step = .walletId
            } catch {
                errorMessage = error.localizedDescription
                step = .contact
            }
        }
    }
}

import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var store: WalletStore
    @EnvironmentObject private var router: AppRouter
    @State private var pastedInvitation = ""
    @State private var isImportFieldShown = false
    @State private var importResult: ImportResult?
    @State private var showProductBrief = false
    // A TextEditor has no return key to dismiss with, so the keyboard needs an
    // explicit way out or it covers the Import button and never goes away.
    @FocusState private var invitationFieldFocused: Bool

    /// The outcome of an import, held so it can be reported once and then
    /// cleared. The store's own message properties persist until the next
    /// import, which made an old result reappear the next time this screen was
    /// visited.
    private struct ImportResult: Identifiable {
        let id = UUID()
        var succeeded: Bool
        var message: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                landingHero
                statusGrid
                gettingStartedCard
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .background(
            LinearGradient(
                colors: [VanguardTheme.mist, .white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        // The hero card already carries the Aegis ID branding, so the navigation
        // title only repeated it and pushed the content down.
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showProductBrief) {
            SafariView(url: AegisWalletEnvironment.productBriefURL).ignoresSafeArea()
        }
        .alert(
            importResult?.succeeded == true ? "Invitation imported" : "That did not work",
            isPresented: Binding(
                get: { importResult != nil },
                set: { if !$0 { importResult = nil } }
            ),
            presenting: importResult
        ) { _ in
            Button("OK", role: .cancel) { importResult = nil }
        } message: { result in
            Text(result.message)
        }
    }

    private var landingHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    VanguardLogoImage()

                    Text("Aegis ID Wallet")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Your personal vault for digital identity. Hold the credentials your organizations issue you, and approve the sign-ins, consents, signatures and authorizations they ask for — from this device, with your own biometric.")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.84))
                }

                Spacer()

                // Home hides its navigation bar, so the help lives in the hero.
                // It stays after setup on purpose: the questions it answers —
                // where the web app is, how to add a second organization —
                // come up long after the first run.
                WalletHelpButton(tint: .white)
                    .font(.title2)
            }

            // Counts that were only counts. Each is a summary of a screen that
            // already exists, so each opens it.
            HStack(spacing: 10) {
                HeroPill(value: "\(store.connections.count)", label: "Connections") {
                    router.openConnections()
                }
                HeroPill(value: "\(store.credentialOrganizations.count)", label: "Orgs") {
                    router.show(.organizations)
                }
                HeroPill(value: "\(store.transactions.count)", label: "Events") {
                    router.show(.ledger)
                }
            }
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [VanguardTheme.navy, VanguardTheme.blue],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var statusGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatusMetricCard(
                title: "Credential orgs",
                value: "\(store.credentialOrganizations.count)",
                systemImage: "building.2.crop.circle",
                tint: VanguardTheme.blue
            )
            StatusMetricCard(
                title: "Pending actions",
                value: "\(store.pendingTransactionCount)",
                systemImage: "bolt.shield",
                tint: VanguardTheme.green
            )
        }
    }

    /// What to do next, and the two ways to do it.
    ///
    /// This replaced a card that showed the pending invitation's own label —
    /// which on a lab connection is the ACA-Py agent's name, so the first thing
    /// a holder read on the home screen was "VCS Issuer". It named an
    /// implementation detail and told them nothing about what to do.
    private var gettingStartedCard: some View {
        VanguardCard {
            VStack(alignment: .leading, spacing: 14) {
                StatusBadge(
                    text: store.credentialOrganizations.isEmpty ? "Nothing here yet" : "Ready",
                    systemImage: "qrcode.viewfinder",
                    tint: VanguardTheme.green
                )

                Text(store.credentialOrganizations.isEmpty
                     ? "Start with an invitation"
                     : "Scan or paste anything Aegis sends you")
                    .font(.title3.bold())

                Text("An invitation to join an organization, a request to approve something, a document to sign, or a sign-in to confirm — they all arrive the same way. Scan the code if it is on another screen, or paste the link if it reached this phone; you cannot scan a code with the device showing it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    invitationFieldFocused = false
                    router.show(.scan)
                } label: {
                    Label("Scan a QR code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VanguardTheme.blue)

                Button {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                        isImportFieldShown.toggle()
                    }
                    if isImportFieldShown {
                        invitationFieldFocused = true
                    }
                } label: {
                    Label(
                        isImportFieldShown ? "Hide the invitation box" : "Import invitation",
                        systemImage: isImportFieldShown ? "chevron.up" : "link.badge.plus"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(VanguardTheme.blue)

                if isImportFieldShown {
                    importField
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                Divider()
                    .padding(.top, 2)

                // Somebody who arrived from the App Store has no idea what the
                // service behind this app is. The brief answers that; the
                // sign-in page would not.
                Button {
                    showProductBrief = true
                } label: {
                    Label("Open the web app", systemImage: "safari")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(VanguardTheme.navy)

                Text("Read what Aegis ID does and how your organization uses it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }

    /// Revealed by the button above rather than always present, so the screen
    /// leads with what to do instead of with an empty box.
    private var importField: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextEditor(text: $pastedInvitation)
                .focused($invitationFieldFocused)
                .font(.system(.footnote, design: .monospaced))
                // An invitation is a URL, and iOS treats it as prose without
                // these: "aegisid-local://" is autocorrected to "Aegis
                // is-local://" and the import fails on a link the holder pasted
                // correctly.
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .frame(minHeight: 92)
                .padding(8)
                .background(VanguardTheme.mist)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(VanguardTheme.line)
                )
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") { invitationFieldFocused = false }
                    }
                }

            Text("Paste the aegisid:// link from the invitation.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                performImport()
            } label: {
                Label("Import", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(VanguardTheme.green)
            .disabled(pastedInvitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    /// Import, then report once.
    ///
    /// The store reports asynchronously for the product path — an organization
    /// invite is accepted over the network — so the outcome is read after the
    /// call settles rather than assumed from it returning.
    private func performImport() {
        invitationFieldFocused = false
        let pasted = pastedInvitation.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pasted.isEmpty else { return }

        store.importInvitation(from: pasted)

        Task { @MainActor in
            // Long enough for the network path to settle, short enough that the
            // holder is still looking at the screen they tapped on.
            try? await Task.sleep(nanoseconds: 900_000_000)

            if let error = store.lastImportError ?? store.lastLabError {
                importResult = ImportResult(succeeded: false, message: error)
                return
            }

            let message = store.lastImportMessage ?? store.lastLabMessage ?? "Invitation imported."
            importResult = ImportResult(succeeded: true, message: message)
            pastedInvitation = ""
            withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                isImportFieldShown = false
            }
        }
    }
}

private struct HeroPill: View {
    var value: String
    var label: String
    var open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                HStack(spacing: 3) {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.72))
                        // Three equal tiles leave "Connections" a hair short of
                        // fitting, and it broke to "Connec-/tions".
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    // Small, but it is the difference between a statistic and
                    // a control.
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.white.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(value) \(label)")
        .accessibilityHint("Opens \(label)")
    }
}

private struct VanguardLogoImage: View {
    var body: some View {
        if let image = Self.logoImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 254, height: 62, alignment: .leading)
                .clipped()
                .accessibilityLabel("Vanguard Cloud Services")
        } else {
            Text("Vanguard Cloud Services")
                .font(.headline.bold())
                .foregroundStyle(.white)
                .accessibilityLabel("Vanguard Cloud Services")
        }
    }

    private static var logoImage: UIImage? {
        guard let path = Bundle.main.path(forResource: "vanguard-logo", ofType: "png") else {
            return UIImage(named: "vanguard-logo")
        }
        return UIImage(contentsOfFile: path)
    }
}

private struct StatusMetricCard: View {
    var title: String
    var value: String
    var systemImage: String
    var tint: Color

    var body: some View {
        VanguardCard {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(tint)
                Text(value)
                    .font(.title.bold())
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environmentObject(WalletStore())
            .environmentObject(AppRouter())
    }
}

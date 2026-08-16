import SafariServices
import SwiftUI
import UIKit

// What to do with a wallet you have just installed.
//
// The App Store is the one route into this app that does not start with an
// invitation: somebody hears about Aegis ID, downloads the wallet, opens it,
// and has nothing to redeem and no idea where the other half of the product
// lives. Everything here answers that — where the web app is, how a Wallet ID
// gets you a credential, and the two places an invitation can be redeemed.
//
// Reachable from first-run setup, the Home hero, and Settings, because the
// question outlasts onboarding: holders join their second organization months
// after their first.
struct WalletHelpView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var showWebApp = false

    /// Setup has no tab bar yet, so the two routes below are described rather
    /// than pointed at while it is on screen.
    var tabsAvailable: Bool = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    webAppCard
                    setUpStep
                    invitationStep
                    manyOrganizations
                    noInvitationYet
                }
                .padding()
            }
            .background(
                LinearGradient(
                    colors: [VanguardTheme.mist, .white],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .navigationTitle("Getting started")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showWebApp) {
            SafariView(url: AegisWalletEnvironment.webAppURL)
                .ignoresSafeArea()
        }
    }

    // MARK: - The web app

    // First, and deliberately the largest thing on the screen. A holder who
    // installed the wallet before registering anywhere needs the address of the
    // service more than they need any instruction on this page.
    private var webAppCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Aegis ID", systemImage: "globe")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.75))

            Text(AegisWalletEnvironment.webAppDisplayValue)
                .font(.system(.title3, design: .monospaced).bold())
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .lineLimit(2)
                .minimumScaleFactor(0.6)

            Text("This wallet is the holder's half of Aegis ID. Organizations sign in on the web to issue credentials and raise approvals; you answer them here.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.84))

            Button {
                showWebApp = true
            } label: {
                Label("Open the web app", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(VanguardTheme.navy)

            Button {
                UIPasteboard.general.string = AegisWalletEnvironment.webAppURL.absoluteString
            } label: {
                Label("Copy the address", systemImage: "doc.on.doc")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(22)
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

    // MARK: - Steps

    private var setUpStep: some View {
        HelpCard(number: "1", title: "Set up this wallet") {
            Text("Give an email address, and the wallet mints a **Wallet ID** and ten single-use recovery codes. The codes are shown once — save them before you continue.")
            Text("The Wallet ID is what you hand an administrator so they can issue a credential to this device. It is an identifier, not a secret: knowing it does not let anybody act as you.")
            Text("It is on the Settings tab whenever you need it again.")
                .foregroundStyle(.secondary)
        }
    }

    private var invitationStep: some View {
        HelpCard(number: "2", title: "Redeem an invitation") {
            Text("A wallet with no invitation holds nothing. An organization sends you one, and there are two ways to take it in.")

            HelpRoute(
                systemImage: "qrcode.viewfinder",
                title: tabsAvailable ? "Scan tab" : "Scan a QR code",
                detail: "Point the camera at an invitation QR shown on a computer screen or printed on a letter."
            )

            HelpRoute(
                systemImage: "link.badge.plus",
                title: tabsAvailable ? "Home tab · Paste invitation" : "Paste the link",
                detail: "For an invitation that arrived by email or message on this phone. Copy the aegisid:// link and paste it in. This is the one to use when the invitation is on the same screen you are holding — you cannot scan a code with the device displaying it."
            )

            Text("Tapping an invitation link on this phone opens the wallet and redeems it directly, so most holders never do either by hand.")
                .foregroundStyle(.secondary)
        }
    }

    // The question that arrives at the second organization, not the first, and
    // the one holders most often solve by installing a second wallet.
    private var manyOrganizations: some View {
        HelpCard(systemImage: "building.2.crop.circle", title: "One wallet, many organizations") {
            Text("You do not need a second wallet for a second organization. Every invitation you redeem adds its organization to this one, and the **Orgs** tab lists them all.")
            Text("They stay separate. Each organization sees only the credentials it issued you and the approvals it asked for — never another organization's, and never the list of who else you hold a credential from.")
            Text("The same Wallet ID works for all of them, so it is safe to give out again.")
                .foregroundStyle(.secondary)
        }
    }

    private var noInvitationYet: some View {
        HelpCard(systemImage: "envelope.badge", title: "No invitation yet?") {
            Text("Ask an administrator at your organization to send one to the email address you registered here, or give them your Wallet ID and they can issue straight to this device.")
            Text("If your organization does not use Aegis ID yet, the web app above is where a workspace is created.")
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Pieces

private struct HelpCard<Content: View>: View {
    var number: String?
    var systemImage: String?
    var title: String
    @ViewBuilder var content: Content

    init(
        number: String? = nil,
        systemImage: String? = nil,
        title: String,
        @ViewBuilder content: () -> Content
    ) {
        self.number = number
        self.systemImage = systemImage
        self.title = title
        self.content = content()
    }

    var body: some View {
        VanguardCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    if let number {
                        Text(number)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(VanguardTheme.blue, in: Circle())
                    } else if let systemImage {
                        Image(systemName: systemImage)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(VanguardTheme.green, in: Circle())
                    }

                    Text(title)
                        .font(.headline)
                }

                VStack(alignment: .leading, spacing: 8) {
                    content
                }
                .font(.subheadline)
            }
        }
    }
}

private struct HelpRoute: View {
    var systemImage: String
    var title: String
    var detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(VanguardTheme.blue)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.bold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VanguardTheme.mist, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// The web app in a browser sheet rather than a hand-off to Safari.
///
/// Leaving the app to answer "where do I start" is the point at which holders
/// stop coming back.
struct SafariView: UIViewControllerRepresentable {
    var url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false

        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.preferredControlTintColor = UIColor(VanguardTheme.blue)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// The icon that opens the help, so every entry point uses the same one.
struct WalletHelpButton: View {
    var tabsAvailable: Bool = true
    /// Nil keeps the accent colour; the Home hero passes white because it sits
    /// on the navy gradient.
    var tint: Color?
    @State private var showHelp = false

    var body: some View {
        Button {
            showHelp = true
        } label: {
            Image(systemName: "questionmark.circle")
                .foregroundStyle(tint ?? .accentColor)
        }
        .accessibilityLabel("Getting started")
        .sheet(isPresented: $showHelp) {
            WalletHelpView(tabsAvailable: tabsAvailable)
        }
    }
}

#Preview {
    WalletHelpView()
}

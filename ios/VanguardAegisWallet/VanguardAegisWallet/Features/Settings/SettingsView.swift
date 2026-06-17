import SwiftUI

struct SettingsView: View {
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

            Section("Simulator lab mode") {
                Text(AegisWalletEnvironment.usesHostedWebApp ? "This app sends lab actions to the hosted Aegis ID bridge, which talks to ACA-Py with server-side admin credentials. It is not a production wallet engine and should not be used with real credentials." : "This app calls local ACA-Py admin APIs for simulator-only testing. It is not a production wallet engine and should not be used with real credentials.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
    }
}

#Preview {
    NavigationStack {
        SettingsView()
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

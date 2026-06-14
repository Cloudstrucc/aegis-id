import SwiftUI

struct SettingsView: View {
    var body: some View {
        List {
            Section("Profile") {
                LabeledContent("Organization", value: "Cloudstrucc Inc.")
                LabeledContent("Wallet", value: "Aegis Wallet")
                LabeledContent("Mode", value: "Aries lab")
            }

            Section("Local ACA-Py") {
                LabeledContent("Issuer admin", value: "localhost:4011")
                LabeledContent("Verifier admin", value: "localhost:5011")
                LabeledContent("Mediator admin", value: "localhost:3011")
            }

            Section("Protocol") {
                LabeledContent("Invitation", value: "Out-of-Band 1.1")
                LabeledContent("Handshake", value: "DIDExchange 1.0")
                LabeledContent("Credential engine", value: "Adapter pending")
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

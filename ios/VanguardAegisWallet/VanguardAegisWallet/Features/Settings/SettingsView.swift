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

            Section("Local ACA-Py") {
                LabeledContent("Web app", value: "localhost:3000")
                LabeledContent("Holder admin", value: "localhost:6011")
                LabeledContent("Issuer admin", value: "localhost:4011")
                LabeledContent("Verifier admin", value: "localhost:5011")
                LabeledContent("Mediator admin", value: "localhost:3011")
            }

            Section("Protocol") {
                LabeledContent("Invitation", value: "Out-of-Band 1.1")
                LabeledContent("Handshake", value: "DIDExchange 1.0")
                LabeledContent("Credential engine", value: "Lab bridge")
            }

            Section("Simulator lab mode") {
                Text("This app calls local ACA-Py admin APIs for simulator-only testing. It is not a production wallet engine and should not be used with real credentials.")
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

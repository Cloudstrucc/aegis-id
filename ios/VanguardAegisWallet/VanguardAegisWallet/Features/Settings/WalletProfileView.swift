import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// The holder's own wallet identity: the Wallet ID they share with administrators,
/// and the contact details that email- and phone-bound invitations match against.
struct WalletProfileView: View {
    @EnvironmentObject private var store: WalletStore

    @State private var showShareSheet = false
    @State private var copied = false
    @State private var changingField: ContactField?
    @State private var newValue = ""
    @State private var busy = false
    @State private var message: String?
    @State private var errorMessage: String?

    enum ContactField: String, Identifiable {
        case email
        case phone

        var id: String { rawValue }
        var title: String { self == .email ? "Email" : "Mobile number" }
        var prompt: String { self == .email ? "New email address" : "New mobile number" }
    }

    var body: some View {
        List {
            walletIdSection
            contactSection
            recoverySection

            if let message {
                Section { Label(message, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            }
            if let errorMessage {
                Section { Label(errorMessage, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
        }
        .navigationTitle("My wallet")
        .sheet(isPresented: $showShareSheet) {
            WalletShareSheet(walletId: store.identity?.walletId ?? "", email: store.identity?.email ?? "")
        }
        .sheet(item: $changingField) { field in
            contactChangeSheet(field)
        }
    }

    // MARK: - Wallet ID

    private var walletIdSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(store.identity?.walletId ?? "Not registered")
                    .font(.system(.title3, design: .monospaced).bold())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 12) {
                    Button {
                        UIPasteboard.general.string = store.identity?.walletId
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(.bordered)

                    Button {
                        showShareSheet = true
                    } label: {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(.vertical, 4)
        } header: {
            Text("Wallet ID")
        } footer: {
            Text("Give this to an organization administrator so they can issue credentials to this wallet. It is an identifier, not a secret.")
        }
    }

    // MARK: - Contact

    private var contactSection: some View {
        Section {
            LabeledContent("Email", value: store.identity?.email ?? "—")
            Button("Change email") { begin(.email) }

            LabeledContent("Mobile", value: store.identity?.phone ?? "Not set")
            Button(store.identity?.phone == nil ? "Add mobile number" : "Change mobile number") { begin(.phone) }
        } header: {
            Text("Contact")
        } footer: {
            Text("Organizations can address an invitation to this email or number when they do not have your Wallet ID. Changing either needs your approval in this wallet.")
        }
    }

    private var recoverySection: some View {
        Section {
            Button("Generate new recovery codes") { regenerateCodes() }
                .disabled(busy || store.identity == nil)

            if !store.pendingRecoveryCodes.isEmpty {
                ForEach(store.pendingRecoveryCodes, id: \.self) { code in
                    Text(code).font(.system(.body, design: .monospaced))
                }
                Button {
                    UIPasteboard.general.string = store.pendingRecoveryCodes.joined(separator: "\n")
                } label: {
                    Label("Copy all codes", systemImage: "doc.on.doc")
                }
                Button("Done") { store.pendingRecoveryCodes = [] }
            }
        } header: {
            Text("Recovery")
        } footer: {
            Text("Generating a new set immediately invalidates the previous one. Save the new codes before leaving this screen.")
        }
    }

    // MARK: - Contact change

    private func contactChangeSheet(_ field: ContactField) -> some View {
        NavigationStack {
            Form {
                Section {
                    TextField(field.prompt, text: $newValue)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(field == .email ? .emailAddress : .phonePad)
                } footer: {
                    Text("This change is staged and only applied once you approve it in this wallet.")
                }

                Section {
                    Button(busy ? "Requesting…" : "Request change") { submitChange(field) }
                        .disabled(busy || newValue.trimmingCharacters(in: .whitespaces).isEmpty)

                    if store.pendingContactChallengeId != nil {
                        Button("Approve change") { resolveChange(approve: true) }.disabled(busy)
                        Button("Decline", role: .destructive) { resolveChange(approve: false) }.disabled(busy)
                    }
                }
            }
            .navigationTitle("Change \(field.title.lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { changingField = nil }
                }
            }
        }
    }

    private func begin(_ field: ContactField) {
        newValue = ""
        message = nil
        errorMessage = nil
        changingField = field
    }

    private func submitChange(_ field: ContactField) {
        busy = true
        errorMessage = nil
        Task {
            do {
                _ = try await store.startContactChange(field: field.rawValue, value: newValue)
                message = "Approve the change to apply it."
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    private func resolveChange(approve: Bool) {
        busy = true
        Task {
            do {
                try await store.resolveContactChange(approve: approve)
                message = approve ? "Contact updated." : "Change declined."
                changingField = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    private func regenerateCodes() {
        busy = true
        errorMessage = nil
        Task {
            do {
                try await store.regenerateRecoveryCodes()
                message = "New codes generated. Save them now."
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}

// MARK: - Share sheet

/// Shows the Wallet ID as a QR an administrator can scan, plus a copyable payload
/// they can paste into the credential form.
struct WalletShareSheet: View {
    let walletId: String
    let email: String
    @Environment(\.dismiss) private var dismiss

    private var payload: String {
        // Same shape the web app's import accepts.
        "aegisid://wallet?wallet_id=\(walletId)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Text("Show this to your administrator, or send them the Wallet ID below.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    if let image = Self.qrImage(from: payload) {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 260, maxHeight: 260)
                            .padding(12)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                    }

                    Text(walletId)
                        .font(.system(.title3, design: .monospaced).bold())
                        .textSelection(.enabled)

                    ShareLink(item: "My Aegis ID Wallet ID is \(walletId)") {
                        Label("Send Wallet ID", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        UIPasteboard.general.string = walletId
                    } label: {
                        Label("Copy Wallet ID", systemImage: "doc.on.doc").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(24)
            }
            .navigationTitle("Share wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    static func qrImage(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else {
            return nil
        }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}

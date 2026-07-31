import SwiftUI

// Wallet recovery on a new device. Recovery re-binds the existing Wallet ID to
// this device's new key — the Wallet ID itself never changes, so the holder does
// not have to re-share it with their organizations.
struct WalletRecoveryView: View {
    @EnvironmentObject private var store: WalletStore
    @Environment(\.dismiss) private var dismiss

    enum Step {
        case identify
        case otp
        case chooseTier
        case enterCode
        case awaitingOrg
        case done
        case hardStop
    }

    @State private var step: Step = .identify
    @State private var identifier = ""
    @State private var otp = ""
    @State private var code = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var summary: String?

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .identify: identifyStep
                case .otp: otpStep
                case .chooseTier: chooseTierStep
                case .enterCode: enterCodeStep
                case .awaitingOrg: awaitingOrgStep
                case .done: doneStep
                case .hardStop: hardStopStep
                }
            }
            .padding(24)
            .navigationTitle("Recover wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var identifyStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Find your wallet").font(.title2.bold())
            Text("Enter your Wallet ID, or the email address you registered.")
                .font(.footnote).foregroundStyle(.secondary)
            TextField("Wallet ID or email", text: $identifier)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            errorText
            Spacer()
            actionButton("Send verification code") {
                try await store.startRecovery(identifier: identifier)
                step = .otp
            }
        }
    }

    private var otpStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Verify it's you").font(.title2.bold())
            Text("Enter the 6-digit code sent to your registered contact.")
                .font(.footnote).foregroundStyle(.secondary)
            TextField("000000", text: $otp)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
            errorText
            Spacer()
            actionButton("Verify") {
                try await store.verifyRecoveryOtp(otp: otp)
                let options = try await store.loadRecoveryOptions()
                step = options.hardStop ? .hardStop : .chooseTier
            }
        }
    }

    private var chooseTierStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("How would you like to recover?").font(.title2.bold())

            if store.recoveryOptions?.canUseCodes == true {
                Button {
                    step = .enterCode
                } label: {
                    optionRow(
                        title: "Use a recovery code",
                        detail: "Fastest. High-assurance credentials stay suspended until an organization re-verifies you."
                    )
                }
            }

            if store.recoveryOptions?.canUseOrgAttestation == true {
                Button {
                    Task { await requestAttestation() }
                } label: {
                    optionRow(
                        title: "Ask my organization",
                        detail: "An administrator confirms your identity. Restores that organization's credentials in full."
                    )
                }
            }

            errorText
            Spacer()
        }
    }

    private var enterCodeStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Enter a recovery code").font(.title2.bold())
            Text("Use one of the codes you saved when you set up this wallet. Each code works once.")
                .font(.footnote).foregroundStyle(.secondary)
            TextField("XXXX-XXXX", text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            errorText
            Spacer()
            actionButton("Recover my wallet") {
                try await store.redeemRecoveryCode(code: code)
                summary = try await store.completeRecovery()
                step = .done
            }
        }
    }

    private var awaitingOrgStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Waiting for approval").font(.title2.bold())
            Text("An administrator needs to confirm your identity. You can close this and come back — we will keep checking.")
                .font(.footnote).foregroundStyle(.secondary)
            ProgressView()
            errorText
            Spacer()
            actionButton("Check again") {
                if try await store.isRecoveryApproved() {
                    summary = try await store.completeRecovery()
                    step = .done
                }
            }
        }
    }

    private var doneStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Wallet recovered", systemImage: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(.green)
            Text(summary ?? "Your wallet is available on this device.")
                .foregroundStyle(.secondary)
            Text("Register a passkey again in Settings — passkeys cannot move between devices.")
                .font(.footnote).foregroundStyle(.secondary)
            Spacer()
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
        }
    }

    private var hardStopStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("We can't recover this wallet", systemImage: "exclamationmark.triangle.fill")
                .font(.title2.bold())
            Text("This wallet has no remaining recovery codes and no connected organization that can confirm your identity. For your security, you will need to enrol again with your organization.")
                .foregroundStyle(.secondary)
            Spacer()
            Button("Close") { dismiss() }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
        }
    }

    private func optionRow(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private var errorText: some View {
        if let errorMessage {
            Text(errorMessage).font(.footnote).foregroundStyle(.red)
        }
    }

    private func actionButton(_ title: String, action: @escaping () async throws -> Void) -> some View {
        Button {
            errorMessage = nil
            busy = true
            Task {
                do {
                    try await action()
                } catch {
                    errorMessage = error.localizedDescription
                }
                busy = false
            }
        } label: {
            if busy {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                Text(title).frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(busy)
    }

    private func requestAttestation() async {
        errorMessage = nil
        do {
            guard let orgId = store.recoveryOptions?.connectedOrgIds.first else {
                errorMessage = "No connected organization is available."
                return
            }
            try await store.requestOrgAttestation(organizationId: orgId)
            step = .awaitingOrg
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

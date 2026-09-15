import SwiftUI

/// "Business Expenses wants to sign you in."
///
/// One decision, two buttons. Everything the holder needs to make it is on the
/// sheet: which application, which wallet is answering, how long they have.
/// Approving asks for Face ID, Touch ID or the passcode before anything is
/// sent — the wallet is standing in as the second factor, so the phone being
/// unlocked is not enough on its own.
struct SignInApprovalSheet: View {
    @EnvironmentObject private var store: WalletStore
    @EnvironmentObject private var router: AppRouter
    @Environment(\.dismiss) private var dismiss

    let pending: PendingSignIn
    @State private var isAnswering = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "person.badge.key.fill")
                        .font(.system(size: 38))
                        .foregroundStyle(VanguardTheme.blue)
                    Text("\(pending.appName) wants to sign you in")
                        .font(.title2.bold())
                    Text("Approve only if you started this sign-in yourself, on a screen you can see. Nobody else can complete it without this wallet.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VanguardCard {
                    VStack(alignment: .leading, spacing: 10) {
                        detailRow("Application", pending.appName)
                        if let organization = organizationName {
                            detailRow("Organization", organization)
                        }
                        detailRow("Answering as", store.identity?.walletId ?? "This wallet")
                        if let expiresAt = pending.expiresAt {
                            detailRow("Expires", expiresAt.formatted(date: .omitted, time: .shortened))
                        }
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()

                Button {
                    answer(approve: true)
                } label: {
                    Label(isAnswering ? "Approving…" : "Approve with Face ID", systemImage: "faceid")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VanguardTheme.green)
                .disabled(isAnswering)

                Button(role: .destructive) {
                    answer(approve: false)
                } label: {
                    Text("Decline")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isAnswering)
            }
            .padding(24)
            .navigationTitle("Sign-in request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Not now") {
                        store.dismissSignIn()
                        dismiss()
                    }
                }
            }
        }
        .interactiveDismissDisabled(isAnswering)
    }

    private var organizationName: String? {
        guard let id = pending.requestedOrganizationId else { return nil }
        return store.organizationProfiles[id]?.organizationName
            ?? store.connections.first { store.organizationId(for: $0) == id }?.invitation.organizationName
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 96, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }

    private func answer(approve: Bool) {
        isAnswering = true
        errorMessage = nil
        Task {
            let entry = await store.answerSignIn(pending, approve: approve)
            isAnswering = false
            if entry != nil {
                dismiss()
                router.flash(FlashNotice(
                    tone: approve ? .success : .failure,
                    message: approve ? "Signed in to \(pending.appName)." : "Declined \(pending.appName)."
                ))
                router.show(.ledger)
            } else {
                errorMessage = store.lastImportError
            }
        }
    }
}

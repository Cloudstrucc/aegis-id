import Foundation
import LocalAuthentication

/// A sign-in request waiting for the holder's answer.
///
/// Held on the store rather than on a screen, because the link can arrive from
/// anywhere — the camera, a paste, a deep link — and the sheet that asks the
/// question has to appear over whichever tab is showing.
struct PendingSignIn: Identifiable, Equatable {
    var id: String { request.challengeId }
    var request: AegisSignInRequest
    var appName: String
    var clientId: String
    var requestedOrganizationId: String?
    var expiresAt: Date?
}

extension WalletStore {
    /// Read what the request is, then ask.
    ///
    /// Nothing is decided here. The describe call is what lets the sheet name
    /// the application; a request that has already expired or been answered
    /// is reported instead of shown.
    func loadSignIn(_ request: AegisSignInRequest) async {
        lastImportError = nil
        lastImportMessage = nil

        guard identity?.walletId != nil else {
            lastImportError = "Finish setting up your wallet before approving a sign-in."
            return
        }

        do {
            let view = try await registrationClient.describeSignIn(
                challengeId: request.challengeId,
                sourceWebAppURL: request.sourceWebAppURL
            )
            guard view.status == "pending" else {
                lastImportError = "That sign-in request has already been answered."
                return
            }
            pendingSignIn = PendingSignIn(
                request: request,
                appName: view.appName,
                clientId: view.clientId,
                requestedOrganizationId: view.requestedOrganizationId,
                expiresAt: ISO8601DateFormatter.aegisFractional.date(from: view.expiresAt)
                    ?? ISO8601DateFormatter().date(from: view.expiresAt)
            )
        } catch {
            lastImportError = error.localizedDescription
        }
    }

    /// Answer the request. Approving asks for the device's biometric or
    /// passcode first: the wallet is the second factor here, and a wallet
    /// anyone holding the phone could approve with is not one.
    ///
    /// Returns the ledger entry, so the caller can send the holder to it.
    @discardableResult
    func answerSignIn(_ pending: PendingSignIn, approve: Bool) async -> WalletTransaction? {
        lastImportError = nil
        lastImportMessage = nil

        guard let walletId = identity?.walletId else {
            lastImportError = "Finish setting up your wallet before approving a sign-in."
            return nil
        }

        if approve {
            do {
                try await authenticateHolder(reason: "Approve signing in to \(pending.appName)")
            } catch {
                lastImportError = "Sign-in was not approved: \(error.localizedDescription)"
                return nil
            }
        }

        do {
            _ = try await registrationClient.answerSignIn(
                challengeId: pending.request.challengeId,
                walletId: walletId,
                approve: approve,
                sourceWebAppURL: pending.request.sourceWebAppURL
            )
            pendingSignIn = nil

            let transaction = WalletTransaction(
                connectionId: connection(forOrganizationId: pending.requestedOrganizationId)?.id
                    ?? connections.first?.id
                    ?? UUID(),
                type: .challenge,
                status: approve ? .accepted : .declined,
                title: "Sign in to \(pending.appName)",
                detail: approve
                    ? "Approved from this wallet with your biometric."
                    : "Declined from this wallet.",
                remoteId: pending.request.challengeId,
                appName: pending.appName,
                action: "sign-in"
            )
            insertTransaction(transaction)
            lastImportMessage = approve
                ? "Signed in to \(pending.appName)."
                : "Declined signing in to \(pending.appName)."
            return transaction
        } catch {
            lastImportError = error.localizedDescription
            return nil
        }
    }

    func dismissSignIn() {
        pendingSignIn = nil
    }

    /// Face ID, Touch ID, or the passcode — whichever the device offers. A
    /// device with none set up cannot approve, deliberately.
    private func authenticateHolder(reason: String) async throws {
        let context = LAContext()
        var unavailable: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &unavailable) else {
            throw SignInError.noDeviceAuthentication
        }
        let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        guard ok else {
            throw SignInError.notAuthenticated
        }
    }

    private func connection(forOrganizationId organizationId: String?) -> WalletConnection? {
        guard let organizationId, !organizationId.isEmpty else {
            return nil
        }
        return connections.first { self.organizationId(for: $0) == organizationId }
    }

    enum SignInError: LocalizedError {
        case noDeviceAuthentication
        case notAuthenticated

        var errorDescription: String? {
            switch self {
            case .noDeviceAuthentication:
                return "Set a passcode, Face ID or Touch ID on this device to approve sign-ins."
            case .notAuthenticated:
                return "you did not confirm with Face ID, Touch ID or your passcode."
            }
        }
    }
}

extension ISO8601DateFormatter {
    /// The server's timestamps carry milliseconds.
    static let aegisFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

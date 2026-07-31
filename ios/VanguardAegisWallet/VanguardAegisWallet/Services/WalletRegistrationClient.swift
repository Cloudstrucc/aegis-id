import Foundation

// Product-path client for wallet identity, contact changes, recovery, and
// organization/credential acceptance.
//
// Everything here talks to the Aegis web app directly. Unlike LabAgentClient it
// never depends on ACA-Py, so these flows work against any deployment where the
// Aries lab is not running.
struct WalletRegistrationClient {
    var webAppURL = AegisWalletEnvironment.webAppURL
    /// Requests time out so a screen can never hang indefinitely.
    var timeout: TimeInterval = 20

    struct RegistrationResult: Decodable {
        let walletId: String
        let email: String
        let phone: String?
    }

    struct RecoveryCodesResult: Decodable {
        let walletId: String
        let codes: [String]
    }

    struct RecoveryOptions: Decodable {
        let walletId: String
        let canUseCodes: Bool
        let remainingCodes: Int
        let canUseOrgAttestation: Bool
        let connectedOrgIds: [String]
        let hardStop: Bool
    }

    struct RecoveryRequest: Decodable {
        let id: String
        let walletId: String
        let tier: String?
        let status: String
        let otpVerified: Bool
    }

    struct RecoveryStart: Decodable {
        let request: RecoveryRequest
        /// Present only outside production, where there is no SMS/email sender.
        let otp: String?
    }

    struct RecoveryCompletion: Decodable {
        let walletId: String
        let restoreScope: String
        let suspendsHighAssurance: Bool
        let coolingOffUntil: String?
        let contactFrozenUntil: String?
    }

    struct ContactChallenge: Decodable {
        let id: String
        let field: String
        let status: String
    }

    // MARK: - Registration

    func register(email: String, phone: String?, devicePublicKey: String, displayName: String?) async throws -> RegistrationResult {
        try await post(path: "api/wallet/register", body: [
            "email": email,
            "phone": phone ?? "",
            "devicePublicKey": devicePublicKey,
            "displayName": displayName ?? ""
        ])
    }

    func generateRecoveryCodes(walletId: String) async throws -> RecoveryCodesResult {
        try await post(path: "api/wallet/\(walletId)/recovery-codes/regenerate", body: [:])
    }

    // MARK: - Organization and credential acceptance

    func acceptOrganizationInvitation(invitationId: String, walletId: String, sourceWebAppURL: String? = nil) async throws {
        let _: EmptyResponse = try await post(
            path: "api/wallet/organization-invitations/\(invitationId)/accept",
            body: ["walletId": walletId, "source": "ios-wallet"],
            baseURL: portalURL(sourceWebAppURL)
        )
    }

    func acceptCredentialInvitation(
        credentialId: String,
        organizationId: String,
        walletId: String,
        sourceWebAppURL: String? = nil
    ) async throws {
        let _: EmptyResponse = try await post(
            path: "api/wallet/credential-invitations/\(credentialId)/accept",
            body: ["organizationId": organizationId, "walletId": walletId, "source": "ios-wallet"],
            baseURL: portalURL(sourceWebAppURL)
        )
    }

    // MARK: - Contact changes (challenge gated)

    func startContactChange(walletId: String, field: String, value: String) async throws -> ContactChallenge {
        try await post(path: "api/wallet/\(walletId)/contact/challenge", body: ["field": field, "value": value])
    }

    func resolveContactChange(challengeId: String, approve: Bool) async throws -> ContactChallenge {
        try await post(
            path: "api/wallet/contact/challenges/\(challengeId)/resolve",
            body: ["decision": approve ? "approve" : "decline"]
        )
    }

    // MARK: - Recovery

    func recoveryOptions(walletId: String) async throws -> RecoveryOptions {
        try await get(path: "api/wallet/\(walletId)/recovery-options")
    }

    func startRecovery(walletId: String?, email: String?) async throws -> RecoveryStart {
        try await post(path: "api/wallet/recovery/start", body: [
            "walletId": walletId ?? "",
            "email": email ?? ""
        ])
    }

    func verifyRecoveryOtp(requestId: String, otp: String) async throws -> RecoveryRequest {
        try await post(path: "api/wallet/recovery/\(requestId)/verify-otp", body: ["otp": otp])
    }

    func redeemRecoveryCode(requestId: String, code: String) async throws -> RecoveryRequest {
        try await post(path: "api/wallet/recovery/\(requestId)/redeem-code", body: ["code": code])
    }

    func requestOrgAttestation(requestId: String, organizationId: String) async throws -> RecoveryRequest {
        try await post(
            path: "api/wallet/recovery/\(requestId)/request-attestation",
            body: ["organizationId": organizationId]
        )
    }

    func recoveryStatus(requestId: String) async throws -> RecoveryRequest {
        try await get(path: "api/wallet/recovery/\(requestId)/status")
    }

    func completeRecovery(requestId: String, devicePublicKey: String) async throws -> RecoveryCompletion {
        try await post(
            path: "api/wallet/recovery/\(requestId)/complete",
            body: ["devicePublicKey": devicePublicKey]
        )
    }

    func cancelRecovery(requestId: String) async throws -> RecoveryRequest {
        try await post(path: "api/wallet/recovery/\(requestId)/cancel", body: [:])
    }

    // MARK: - Transport

    private struct EmptyResponse: Decodable {}

    private struct ServerError: Decodable {
        let error: ServerErrorBody?
        struct ServerErrorBody: Decodable {
            let message: String?
        }
    }

    private func portalURL(_ sourceWebAppURL: String?) -> URL {
        guard let sourceWebAppURL, let url = URL(string: sourceWebAppURL), url.host() != nil else {
            return webAppURL
        }
        return url
    }

    private func get<T: Decodable>(path: String, baseURL: URL? = nil) async throws -> T {
        var request = URLRequest(url: (baseURL ?? webAppURL).appending(path: path))
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func post<T: Decodable>(path: String, body: [String: String], baseURL: URL? = nil) async throws -> T {
        var request = URLRequest(url: (baseURL ?? webAppURL).appending(path: path))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body.filter { !$0.value.isEmpty })
        return try await send(request)
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw WalletRegistrationError.transport("No response from the Aegis service.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error?.message
            throw WalletRegistrationError.server(message ?? "Request failed (\(http.statusCode)).")
        }
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

enum WalletRegistrationError: LocalizedError {
    case transport(String)
    case server(String)
    case walletMismatch

    var errorDescription: String? {
        switch self {
        case .transport(let message), .server(let message):
            return message
        case .walletMismatch:
            return "This invitation is for a different wallet."
        }
    }
}

import Foundation

struct LabAgentClient {
    var holderAdminURL = AegisWalletEnvironment.holderAdminURL
    var issuerAdminURL = AegisWalletEnvironment.issuerAdminURL
    var webAppURL = AegisWalletEnvironment.webAppURL

    func acceptInvitation(rawURL: String) async throws -> LabAcceptance {
        if usesHostedLabBridge {
            return try await post(
                webAppURL.appending(path: "api/wallet-lab/accept-invitation"),
                body: try JSONEncoder().encode(HostedInvitationAcceptanceRequest(rawInvitationUrl: rawURL))
            )
        }

        let invitationData = try invitationPayloadData(from: rawURL)
        let invitation = try JSONDecoder().decode(OOBInvitation.self, from: invitationData)
        let response: OOBReceiveResponse = try await post(
            holderAdminURL.appending(path: "out-of-band/receive-invitation"),
            queryItems: [
                URLQueryItem(name: "auto_accept", value: "true"),
                URLQueryItem(name: "use_existing_connection", value: "true")
            ],
            body: invitationData
        )

        let holder = try await waitForConnection(
            adminURL: holderAdminURL,
            connectionId: response.connectionId
        )
        let invitationMessageId = response.invitationMessageId ?? invitation.id
        let issuer = try await waitForIssuerConnection(invitationId: invitationMessageId)

        return LabAcceptance(
            holderConnectionId: holder.connectionId,
            issuerConnectionId: issuer?.connectionId,
            invitationMessageId: invitationMessageId,
            holderState: holder.displayState,
            issuerState: issuer?.displayState
        )
    }

    func issueMockCredential(issuerConnectionId: String, subjectEmail: String) async throws {
        if usesHostedLabBridge {
            _ = try await post(
                webAppURL.appending(path: "api/wallet-lab/issuer-mock-credential"),
                body: try JSONEncoder().encode(
                    HostedIssueMockCredentialRequest(
                        issuerConnectionId: issuerConnectionId,
                        subjectEmail: subjectEmail
                    )
                )
            ) as HostedOKResponse
            return
        }

        let content = """
        Vanguard mock credential offer:
        type=VanguardEmployeeCredential
        email=\(subjectEmail)
        employmentStatus=active
        assuranceLevel=LAB_SIMULATOR
        """
        _ = try await post(
            issuerAdminURL.appending(path: "connections/\(issuerConnectionId)/send-message"),
            body: try JSONEncoder().encode(["content": content])
        ) as EmptyResponse
    }

    func sendChallenge(issuerConnectionId: String) async throws -> String? {
        if usesHostedLabBridge {
            let response: HostedIssuerChallengeResponse = try await post(
                webAppURL.appending(path: "api/wallet-lab/issuer-challenge"),
                body: try JSONEncoder().encode(HostedIssuerChallengeRequest(issuerConnectionId: issuerConnectionId))
            )
            return response.threadId
        }

        let ping: PingResponse = try await post(
            issuerAdminURL.appending(path: "connections/\(issuerConnectionId)/send-ping"),
            body: try JSONEncoder().encode(["comment": "Vanguard Aegis ID simulator wallet challenge"])
        )

        _ = try await post(
            issuerAdminURL.appending(path: "connections/\(issuerConnectionId)/send-message"),
            body: try JSONEncoder().encode(["content": "Vanguard Aegis ID wallet challenge: accept this challenge in the simulator."])
        ) as EmptyResponse

        return ping.threadId
    }

    func sendHolderMessage(holderConnectionId: String, content: String) async throws {
        if usesHostedLabBridge {
            _ = try await post(
                webAppURL.appending(path: "api/wallet-lab/holder-message"),
                body: try JSONEncoder().encode(
                    HostedHolderMessageRequest(
                        holderConnectionId: holderConnectionId,
                        content: content
                    )
                )
            ) as HostedOKResponse
            return
        }

        _ = try await post(
            holderAdminURL.appending(path: "connections/\(holderConnectionId)/send-message"),
            body: try JSONEncoder().encode(["content": content])
        ) as EmptyResponse
    }

    func fetchOIDCWalletChallenges(issuerConnectionId: String) async throws -> [OIDCWalletChallenge] {
        let response: OIDCWalletChallengeList = try await get(
            webAppURL.appending(path: "api/oidc-wallet/challenges"),
            queryItems: [
                URLQueryItem(name: "connectionId", value: issuerConnectionId)
            ]
        )
        return response.challenges
    }

    func acceptOIDCWalletChallenge(sessionId: String) async throws {
        _ = try await post(
            webAppURL.appending(path: "api/oidc-wallet/challenges/\(sessionId)/accept"),
            body: Data("{}".utf8)
        ) as OIDCWalletChallengeAcceptance
    }

    func acceptWalletChallenge(acceptPath: String) async throws {
        try await acceptWalletChallenge(acceptPath: acceptPath, body: ["source": "ios-wallet"])
    }

    func acceptWalletChallenge(acceptPath: String, subject: String, challengeId: String?, passkeyResponse: WalletPasskeyCeremonyResponse) async throws {
        let body = WalletPasskeyChallengeAcceptanceRequest(
            subject: subject,
            source: "ios-wallet-passkey",
            challengeId: challengeId,
            response: passkeyResponse
        )
        try await acceptWalletChallenge(acceptPath: acceptPath, body: body)
    }

    func fetchWalletPasskeyStatus(subject: String) async throws -> WalletPasskeyStatus {
        try await get(
            webAppURL.appending(path: "api/wallet/passkeys/status"),
            queryItems: [URLQueryItem(name: "subject", value: subject)]
        )
    }

    func startWalletPasskeyRegistration(subject: String, displayName: String) async throws -> WalletPasskeyOptionsEnvelope {
        try await post(
            webAppURL.appending(path: "api/wallet/passkeys/register/options"),
            body: try JSONEncoder().encode(WalletPasskeySubjectRequest(subject: subject, displayName: displayName, challengeId: nil))
        )
    }

    func finishWalletPasskeyRegistration(subject: String, response: WalletPasskeyCeremonyResponse) async throws -> WalletPasskeyVerificationEnvelope {
        try await post(
            webAppURL.appending(path: "api/wallet/passkeys/register/verify"),
            body: try JSONEncoder().encode(WalletPasskeyVerificationRequest(subject: subject, source: "ios-wallet", challengeId: nil, response: response))
        )
    }

    func startWalletPasskeyAuthentication(subject: String, challengeId: String?) async throws -> WalletPasskeyOptionsEnvelope {
        try await post(
            webAppURL.appending(path: "api/wallet/passkeys/authenticate/options"),
            body: try JSONEncoder().encode(WalletPasskeySubjectRequest(subject: subject, displayName: nil, challengeId: challengeId))
        )
    }

    func finishWalletPasskeyAuthentication(subject: String, challengeId: String?, response: WalletPasskeyCeremonyResponse) async throws -> WalletPasskeyVerificationEnvelope {
        try await post(
            webAppURL.appending(path: "api/wallet/passkeys/authenticate/verify"),
            body: try JSONEncoder().encode(WalletPasskeyVerificationRequest(subject: subject, source: "ios-wallet", challengeId: challengeId, response: response))
        )
    }

    private func acceptWalletChallenge<Body: Encodable>(acceptPath: String, body: Body) async throws {
        let trimmed = acceptPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let url: URL
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            guard let absolute = URL(string: trimmed) else {
                throw LabAgentError.invalidURL
            }
            url = absolute
        } else {
            url = webAppURL.appending(path: trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        }
        _ = try await post(
            url,
            body: try JSONEncoder().encode(body)
        ) as OIDCWalletChallengeAcceptance
    }

    func registerIssuerOrganizationConnection(
        organizationId: String,
        holderConnectionId: String,
        issuerConnectionId: String?,
        invitationId: String?
    ) async throws {
        _ = try await post(
            webAppURL.appending(path: "api/issuer-organizations/\(organizationId)/connections"),
            body: try JSONEncoder().encode(
                IssuerOrganizationConnectionRegistration(
                    holderConnectionId: holderConnectionId,
                    issuerConnectionId: issuerConnectionId,
                    invitationId: invitationId
                )
            )
        ) as IssuerOrganizationConnectionRegistrationResponse
    }

    func fetchOrganizationProfile(organizationId: String) async throws -> OrganizationProfile {
        try await get(webAppURL.appending(path: "api/organizations/\(organizationId)/profile"))
    }

    private var usesHostedLabBridge: Bool {
        AegisWalletEnvironment.usesHostedWebApp
    }

    private func waitForIssuerConnection(invitationId: String?) async throws -> AgentConnectionRecord? {
        guard let invitationId else {
            return nil
        }

        for _ in 0..<16 {
            let records = try await listConnections(adminURL: issuerAdminURL)
            if let match = records.first(where: {
                $0.invitationMessageId == invitationId && ($0.rfc23State == "completed" || $0.state == "active")
            }) {
                return match
            }
            try await Task.sleep(nanoseconds: 350_000_000)
        }

        return nil
    }

    private func waitForConnection(adminURL: URL, connectionId: String) async throws -> AgentConnectionRecord {
        for _ in 0..<16 {
            let record: AgentConnectionRecord = try await get(adminURL.appending(path: "connections/\(connectionId)"))
            if record.rfc23State == "completed" || record.state == "active" {
                return record
            }
            try await Task.sleep(nanoseconds: 350_000_000)
        }

        return try await get(adminURL.appending(path: "connections/\(connectionId)"))
    }

    private func listConnections(adminURL: URL) async throws -> [AgentConnectionRecord] {
        let response: AgentConnectionList = try await get(adminURL.appending(path: "connections"))
        return response.results
    }

    private func invitationPayloadData(from rawURL: String) throws -> Data {
        guard let url = URL(string: rawURL),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let encoded = components.queryItems?.first(where: { $0.name == "oob" })?.value
        else {
            throw LabAgentError.invalidInvitation
        }

        var base64 = encoded
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        guard let data = Data(base64Encoded: base64) else {
            throw LabAgentError.invalidInvitation
        }
        return data
    }

    private func get<Response: Decodable>(_ url: URL, queryItems: [URLQueryItem] = []) async throws -> Response {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let requestURL = components?.url else {
            throw LabAgentError.invalidURL
        }

        let (data, response) = try await URLSession.shared.data(from: requestURL)
        try validate(response: response, data: data)
        return try decode(Response.self, from: data)
    }

    private func post<Response: Decodable>(_ url: URL, queryItems: [URLQueryItem] = [], body: Data) async throws -> Response {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let requestURL = components?.url else {
            throw LabAgentError.invalidURL
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try decode(Response.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw LabAgentError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "No response body"
            throw LabAgentError.httpError(status: http.statusCode, body: body)
        }
    }

    private func decode<Response: Decodable>(_ type: Response.Type, from data: Data) throws -> Response {
        if Response.self == EmptyResponse.self, data.isEmpty || String(data: data, encoding: .utf8) == "{}" {
            return EmptyResponse() as! Response
        }

        let decoder = JSONDecoder()
        return try decoder.decode(Response.self, from: data.isEmpty ? Data("{}".utf8) : data)
    }
}

struct OOBInvitation: Decodable {
    var id: String?

    enum CodingKeys: String, CodingKey {
        case id = "@id"
    }
}

struct LabAcceptance: Decodable {
    var holderConnectionId: String
    var issuerConnectionId: String?
    var invitationMessageId: String?
    var holderState: String
    var issuerState: String?
}

struct HostedInvitationAcceptanceRequest: Encodable {
    var rawInvitationUrl: String
}

struct HostedIssueMockCredentialRequest: Encodable {
    var issuerConnectionId: String
    var subjectEmail: String
}

struct HostedIssuerChallengeRequest: Encodable {
    var issuerConnectionId: String
}

struct HostedIssuerChallengeResponse: Decodable {
    var ok: Bool
    var threadId: String?
}

struct HostedHolderMessageRequest: Encodable {
    var holderConnectionId: String
    var content: String
}

struct HostedOKResponse: Decodable {
    var ok: Bool
}

struct OOBReceiveResponse: Decodable {
    var connectionId: String
    var invitationMessageId: String?

    enum CodingKeys: String, CodingKey {
        case connectionId = "connection_id"
        case invitationMessageId = "invi_msg_id"
    }
}

struct AgentConnectionList: Decodable {
    var results: [AgentConnectionRecord]
}

struct AgentConnectionRecord: Decodable {
    var connectionId: String
    var state: String?
    var rfc23State: String?
    var theirLabel: String?
    var invitationMessageId: String?

    var displayState: String {
        rfc23State ?? state ?? "unknown"
    }

    enum CodingKeys: String, CodingKey {
        case connectionId = "connection_id"
        case state
        case rfc23State = "rfc23_state"
        case theirLabel = "their_label"
        case invitationMessageId = "invitation_msg_id"
    }
}

struct PingResponse: Decodable {
    var threadId: String?

    enum CodingKeys: String, CodingKey {
        case threadId = "thread_id"
    }
}

struct OIDCWalletChallengeList: Decodable {
    var challenges: [OIDCWalletChallenge]
}

struct OIDCWalletChallenge: Decodable, Hashable {
    var sessionId: String
    var challengeId: String
    var nonce: String
    var status: String
    var connectionId: String
    var threadId: String?
    var sentAt: String?
    var subject: String
    var organizationName: String
    var issuer: String?
    var appName: String?
    var action: String?
    var challengeType: String?
    var resourceType: String?
    var resourceId: String?
    var title: String?
    var detail: String?
    var acceptPath: String?
    var passkeyAcceptPath: String?
    var requiresPasskey: Bool?
    var requiredAssurance: String?
    var payloadFields: [WalletChallengePayloadField]?
}

struct OIDCWalletChallengeAcceptance: Decodable {
    var ok: Bool
    var status: String
    var appUrl: String?
}

struct WalletPasskeySubjectRequest: Encodable {
    var subject: String
    var displayName: String?
    var challengeId: String?
}

struct WalletPasskeyVerificationRequest: Encodable {
    var subject: String
    var source: String
    var challengeId: String?
    var response: WalletPasskeyCeremonyResponse
}

struct WalletPasskeyChallengeAcceptanceRequest: Encodable {
    var subject: String
    var source: String
    var challengeId: String?
    var response: WalletPasskeyCeremonyResponse
}

struct IssuerOrganizationConnectionRegistration: Encodable {
    var holderConnectionId: String
    var issuerConnectionId: String?
    var invitationId: String?
}

struct IssuerOrganizationConnectionRegistrationResponse: Decodable {
    var ok: Bool
}

struct EmptyResponse: Decodable {}

enum LabAgentError: LocalizedError {
    case invalidInvitation
    case invalidResponse
    case invalidURL
    case httpError(status: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .invalidInvitation:
            return "The invitation URL does not contain a valid Aries oob payload."
        case .invalidResponse:
            return "The ACA-Py admin API returned an invalid response."
        case .invalidURL:
            return "The ACA-Py admin URL could not be built."
        case .httpError(let status, let body):
            return "ACA-Py returned HTTP \(status): \(body)"
        }
    }
}

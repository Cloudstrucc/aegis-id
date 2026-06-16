import Foundation

struct LabAgentClient {
    var holderAdminURL = URL(string: "http://localhost:6011")!
    var issuerAdminURL = URL(string: "http://localhost:4011")!
    var webAppURL = URL(string: "http://localhost:3000")!

    func acceptInvitation(rawURL: String) async throws -> LabAcceptance {
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
        let content = """
        Cloudstrucc mock credential offer:
        type=CloudstruccEmployeeCredential
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
        let ping: PingResponse = try await post(
            issuerAdminURL.appending(path: "connections/\(issuerConnectionId)/send-ping"),
            body: try JSONEncoder().encode(["comment": "Cloudstrucc simulator wallet challenge"])
        )

        _ = try await post(
            issuerAdminURL.appending(path: "connections/\(issuerConnectionId)/send-message"),
            body: try JSONEncoder().encode(["content": "Cloudstrucc wallet challenge: accept this challenge in the simulator."])
        ) as EmptyResponse

        return ping.threadId
    }

    func sendHolderMessage(holderConnectionId: String, content: String) async throws {
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

struct LabAcceptance {
    var holderConnectionId: String
    var issuerConnectionId: String?
    var invitationMessageId: String?
    var holderState: String
    var issuerState: String?
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
    var issuer: String?
}

struct OIDCWalletChallengeAcceptance: Decodable {
    var ok: Bool
    var status: String
    var appUrl: String?
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

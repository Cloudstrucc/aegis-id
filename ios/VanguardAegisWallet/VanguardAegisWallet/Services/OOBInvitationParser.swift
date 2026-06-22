import Foundation

struct AegisCredentialInvite: Equatable, Hashable {
    var organizationId: String
    var organizationName: String
    var credentialId: String
    var holderEmail: String
    var expiresAt: String?
    var sourceWebAppURL: String?
    var rawURL: String
}

enum AegisCredentialInviteParser {
    static func canParse(_ rawText: String) -> Bool {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else {
            return false
        }

        return isCredentialInvite(components)
    }

    static func parse(_ rawText: String) throws -> AegisCredentialInvite {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed), isCredentialInvite(components) else {
            throw ParserError.invalidInviteURL
        }

        let queryItems = components.queryItems ?? []
        let credentialId = queryValue(["credential_id", "credentialId"], in: queryItems)
            ?? credentialIdFromPath(components.path)
        guard let organizationId = queryValue(["organization_id", "organizationId"], in: queryItems),
              let credentialId,
              !organizationId.isEmpty,
              !credentialId.isEmpty
        else {
            throw ParserError.missingRequiredFields
        }

        return AegisCredentialInvite(
            organizationId: organizationId,
            organizationName: queryValue(["organization_name", "organizationName"], in: queryItems) ?? "Vanguard organization",
            credentialId: credentialId,
            holderEmail: queryValue(["holder_email", "holderEmail"], in: queryItems) ?? "",
            expiresAt: queryValue(["expires_at", "expiresAt"], in: queryItems),
            sourceWebAppURL: sourceWebAppURL(from: queryItems, fallbackComponents: components),
            rawURL: trimmed
        )
    }

    private static func isCredentialInvite(_ components: URLComponents) -> Bool {
        if components.scheme == "aegisid", components.host == "credential-invite" {
            return true
        }

        return components.path.contains("/wallet/credential-invitations/")
    }

    private static func credentialIdFromPath(_ path: String) -> String? {
        guard path.contains("/wallet/credential-invitations/") else {
            return nil
        }
        return path.split(separator: "/").last.map(String.init)
    }

    private static func queryValue(_ names: [String], in items: [URLQueryItem]) -> String? {
        for name in names {
            if let value = items.first(where: { $0.name == name })?.value, !value.isEmpty {
                return value
            }
        }
        return nil
    }
}

extension AegisCredentialInviteParser {
    enum ParserError: LocalizedError {
        case invalidInviteURL
        case missingRequiredFields

        var errorDescription: String? {
            switch self {
            case .invalidInviteURL:
                return "Paste an Aegis ID credential invitation URL."
            case .missingRequiredFields:
                return "The credential invitation is missing organization or credential details."
            }
        }
    }
}

struct OpenIDVCPresentationRequest: Equatable, Hashable {
    var rawURL: String
    var requestURI: String
    var state: String?
    var clientId: String?
    var nonce: String?
}

enum OpenIDVCPresentationRequestParser {
    static func canParse(_ rawText: String) -> Bool {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else {
            return false
        }

        return components.scheme == "openid-vc"
    }

    static func parse(_ rawText: String) throws -> OpenIDVCPresentationRequest {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              components.scheme == "openid-vc"
        else {
            throw ParserError.invalidOpenIDVCURL
        }

        let queryItems = components.queryItems ?? []
        guard let requestURI = queryValue(["request_uri", "requestUri"], in: queryItems),
              !requestURI.isEmpty
        else {
            throw ParserError.missingRequestURI
        }

        return OpenIDVCPresentationRequest(
            rawURL: trimmed,
            requestURI: requestURI,
            state: queryValue(["state"], in: queryItems),
            clientId: queryValue(["client_id", "clientId"], in: queryItems),
            nonce: queryValue(["nonce"], in: queryItems)
        )
    }

    enum ParserError: LocalizedError {
        case invalidOpenIDVCURL
        case missingRequestURI

        var errorDescription: String? {
            switch self {
            case .invalidOpenIDVCURL:
                return "Paste an OpenID VC presentation request URL."
            case .missingRequestURI:
                return "The OpenID VC presentation request is missing a request_uri parameter."
            }
        }
    }
}

enum OOBInvitationParser {
    static func parse(_ rawText: String) throws -> AriesInvitation {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = try normalizeInvitationURL(trimmed)

        guard let url = URL(string: normalized),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems,
              let encodedInvitation = queryItems.first(where: { $0.name == "oob" })?.value
        else {
            throw ParserError.missingOOBParameter
        }

        let payloadData = try decodeBase64URL(encodedInvitation)
        let payload = try JSONDecoder().decode(OutOfBandPayload.self, from: payloadData)
        let endpoint = endpointDescription(from: components, queryItems: queryItems)

        return AriesInvitation(
            id: payload.id,
            label: payload.label ?? "Aries Invitation",
            rawURL: normalized,
            endpoint: endpoint,
            organizationId: queryValue(["vanguard_org_id", "cloudstrucc_org_id"], in: queryItems),
            organizationName: queryValue(["vanguard_org_name", "cloudstrucc_org_name"], in: queryItems),
            subscriptionId: queryValue(["vanguard_subscription_id", "cloudstrucc_subscription_id"], in: queryItems),
            sourceWebAppURL: sourceWebAppURL(from: queryItems, fallbackComponents: components),
            handshakeProtocols: payload.handshakeProtocols ?? [],
            services: payload.services?.map(\.value) ?? [],
            receivedAt: Date()
        )
    }

    private static func normalizeInvitationURL(_ value: String) throws -> String {
        guard let url = URL(string: value),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            throw ParserError.missingOOBParameter
        }

        if components.queryItems?.contains(where: { $0.name == "oob" }) == true {
            return value
        }

        let wrappedNames = ["invitation", "invitation_url", "invitationUrl", "url", "requestUrl"]
        for name in wrappedNames {
            if let wrapped = components.queryItems?.first(where: { $0.name == name })?.value,
               let wrappedURL = URL(string: wrapped),
               let wrappedComponents = URLComponents(url: wrappedURL, resolvingAgainstBaseURL: false),
               wrappedComponents.queryItems?.contains(where: { $0.name == "oob" }) == true {
                return wrapped
            }
        }

        throw ParserError.missingOOBParameter
    }

    private static func decodeBase64URL(_ value: String) throws -> Data {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        guard let data = Data(base64Encoded: base64) else {
            throw ParserError.invalidBase64
        }

        return data
    }

    private static func endpointDescription(from components: URLComponents, queryItems: [URLQueryItem]) -> String? {
        if let endpoint = queryItems.first(where: { $0.name == "endpoint" })?.value,
           !endpoint.isEmpty {
            return endpoint
        }

        guard let scheme = components.scheme, let host = components.host else {
            return nil
        }

        if let port = components.port {
            return "\(scheme)://\(host):\(port)"
        }

        return "\(scheme)://\(host)"
    }

    private static func queryValue(_ names: [String], in items: [URLQueryItem]) -> String? {
        for name in names {
            if let value = items.first(where: { $0.name == name })?.value, !value.isEmpty {
                return value
            }
        }
        return nil
    }
}

private func sourceWebAppURL(from items: [URLQueryItem], fallbackComponents: URLComponents) -> String? {
    if let explicit = queryValue(
        ["vanguard_web_app_url", "source_web_app_url", "sourceWebAppURL", "cloudstrucc_web_app_url"],
        in: items
    ) {
        return explicit
    }

    guard fallbackComponents.scheme == "http" || fallbackComponents.scheme == "https",
          let scheme = fallbackComponents.scheme,
          let host = fallbackComponents.host
    else {
        return nil
    }

    if let port = fallbackComponents.port {
        return "\(scheme)://\(host):\(port)"
    }

    return "\(scheme)://\(host)"
}

private func queryValue(_ names: [String], in items: [URLQueryItem]) -> String? {
    for name in names {
        if let value = items.first(where: { $0.name == name })?.value, !value.isEmpty {
            return value
        }
    }
    return nil
}

extension OOBInvitationParser {
    enum ParserError: LocalizedError {
        case missingOOBParameter
        case invalidBase64

        var errorDescription: String? {
            switch self {
            case .missingOOBParameter:
                return "Paste an Aries out-of-band invitation URL containing an oob parameter."
            case .invalidBase64:
                return "The out-of-band invitation could not be decoded."
            }
        }
    }
}

private struct OutOfBandPayload: Decodable {
    var type: String?
    var id: String
    var label: String?
    var handshakeProtocols: [String]?
    var services: [ServiceValue]?

    enum CodingKeys: String, CodingKey {
        case type = "@type"
        case id = "@id"
        case label
        case handshakeProtocols = "handshake_protocols"
        case services
    }
}

private struct ServiceValue: Decodable {
    var value: String

    init(from decoder: Decoder) throws {
        let singleValue = try decoder.singleValueContainer()
        if let string = try? singleValue.decode(String.self) {
            value = string
            return
        }

        let object = try decoder.container(keyedBy: DynamicCodingKey.self)
        if let endpointKey = DynamicCodingKey(stringValue: "serviceEndpoint"),
           let endpoint = try? object.decode(String.self, forKey: endpointKey) {
            value = endpoint
            return
        }

        if let idKey = DynamicCodingKey(stringValue: "id"),
           let id = try? object.decode(String.self, forKey: idKey) {
            value = id
            return
        }

        value = "service"
    }
}

private struct DynamicCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        self.stringValue = "\(intValue)"
        self.intValue = intValue
    }
}

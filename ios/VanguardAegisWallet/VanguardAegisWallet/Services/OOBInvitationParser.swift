import Foundation

struct AegisCredentialInvite: Equatable, Hashable {
    var organizationId: String
    var organizationName: String
    var credentialId: String
    var holderEmail: String
    /// Present on Wallet-ID-bound (mode 1) invites so the app can reject an
    /// invitation addressed to a different wallet before calling the server.
    var walletId: String?
    var bindingMode: String?
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
            walletId: queryValue(["wallet_id", "walletId"], in: queryItems),
            bindingMode: queryValue(["binding_mode", "bindingMode"], in: queryItems),
            expiresAt: queryValue(["expires_at", "expiresAt"], in: queryItems),
            sourceWebAppURL: sourceWebAppURL(from: queryItems, fallbackComponents: components),
            rawURL: trimmed
        )
    }

    private static func isCredentialInvite(_ components: URLComponents) -> Bool {
        // Any Aegis scheme, not just the production one — each build registers
        // its own, so a literal match dropped every dev and qa invite.
        if AegisWalletEnvironment.isAegisScheme(components.scheme),
           components.host?.lowercased() == "credential-invite" {
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

// MARK: - Organization invitations (product path)

/// `aegisid://org-invite?...` — the ACA-Py-free organization invitation. The
/// wallet accepts these through the product API, so they work on deployments
/// where the Aries lab is not running.
struct AegisOrganizationInvite: Equatable, Hashable {
    var invitationId: String
    var organizationId: String
    var organizationName: String
    var sourceWebAppURL: String?
    var rawURL: String
}

enum AegisOrganizationInviteParser {
    static func canParse(_ rawText: String) -> Bool {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else {
            return false
        }
        return isOrganizationInvite(components)
    }

    static func parse(_ rawText: String) throws -> AegisOrganizationInvite {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed), isOrganizationInvite(components) else {
            throw ParserError.invalidInviteURL
        }

        let items = components.queryItems ?? []
        guard let invitationId = value(["invitation_id", "invitationId"], in: items),
              let organizationId = value(["organization_id", "organizationId"], in: items),
              !invitationId.isEmpty,
              !organizationId.isEmpty
        else {
            throw ParserError.missingRequiredFields
        }

        return AegisOrganizationInvite(
            invitationId: invitationId,
            organizationId: organizationId,
            organizationName: value(["organization_name", "organizationName"], in: items) ?? "Vanguard organization",
            sourceWebAppURL: value(["vanguard_web_app_url"], in: items),
            rawURL: trimmed
        )
    }

    private static func isOrganizationInvite(_ components: URLComponents) -> Bool {
        let host = components.host?.lowercased()
        let path = components.path.lowercased()
        // Not a literal "aegisid": each build registers its own scheme, so
        // matching the production one dropped every dev and qa link.
        return AegisWalletEnvironment.isAegisScheme(components.scheme)
            && (host == "org-invite" || path.contains("org-invite"))
    }

    private static func value(_ names: [String], in items: [URLQueryItem]) -> String? {
        for name in names {
            if let found = items.first(where: { $0.name == name })?.value, !found.isEmpty {
                return found
            }
        }
        return nil
    }

    enum ParserError: LocalizedError {
        case invalidInviteURL
        case missingRequiredFields

        var errorDescription: String? {
            switch self {
            case .invalidInviteURL:
                return "That QR code is not an Aegis organization invitation."
            case .missingRequiredFields:
                return "This organization invitation is missing required details."
            }
        }
    }
}

// MARK: - Root wallet confirmation and break-glass authorisation

/// `aegisid://root-wallet-confirm?wallet_id=…&token=…`
///
/// An organization has nominated this wallet as one that can recover
/// administrative control. Nominating alone grants nothing — the token in this
/// link is what turns a nomination into a confirmed root wallet, which is why
/// it travels in the QR and appears nowhere on the page that produced it.
struct AegisRootWalletConfirmation: Equatable, Hashable {
    /// The wallet the organization nominated, taken from the link. Unlike the
    /// break-glass case this is knowable in advance, so the server binds the
    /// token to it and the app can say plainly when it is a different device.
    var walletId: String
    var token: String
    var sourceWebAppURL: String?
    var rawURL: String
}

/// `aegisid://break-glass-authorise?token=…`
///
/// A root wallet granting the standing permission that makes a break-glass code
/// usable. The link deliberately carries no Wallet ID: *any* of the
/// organization's confirmed root wallets may authorise, so the scanning wallet
/// supplies its own. That is what makes the authorisation mean "a root wallet
/// of this organization agreed" rather than "somebody had this link".
struct AegisBreakGlassAuthorisation: Equatable, Hashable {
    var token: String
    var sourceWebAppURL: String?
    var rawURL: String
}

/// `aegisid://recovery-approve?request_id=…&token=…`
///
/// An administrator of an organization this wallet is a root wallet of has lost
/// their device. Two root wallets have to approve before they are re-enrolled.
///
/// The token names *this* wallet and was sent to its holder's own address,
/// never to the person recovering — which is what stops a stolen inbox from
/// approving its own recovery. The wallet still supplies its own Wallet ID.
struct AegisRecoveryApproval: Equatable, Hashable {
    var requestId: String
    var token: String
    var sourceWebAppURL: String?
    var rawURL: String
}

enum AegisRootWalletLinkParser {
    static func canParseConfirmation(_ rawText: String) -> Bool {
        components(rawText).map { isHost($0, "root-wallet-confirm") } ?? false
    }

    static func canParseBreakGlass(_ rawText: String) -> Bool {
        components(rawText).map { isHost($0, "break-glass-authorise") } ?? false
    }

    static func canParseRecoveryApproval(_ rawText: String) -> Bool {
        components(rawText).map { isHost($0, "recovery-approve") } ?? false
    }

    static func parseRecoveryApproval(_ rawText: String) throws -> AegisRecoveryApproval {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = components(trimmed), isHost(parts, "recovery-approve") else {
            throw ParserError.invalidLink
        }

        let items = parts.queryItems ?? []
        guard let requestId = value(["request_id", "requestId"], in: items),
              let token = value(["token"], in: items)
        else {
            throw ParserError.missingRequiredFields
        }

        return AegisRecoveryApproval(
            requestId: requestId,
            token: token,
            sourceWebAppURL: value(["vanguard_web_app_url"], in: items),
            rawURL: trimmed
        )
    }

    static func parseConfirmation(_ rawText: String) throws -> AegisRootWalletConfirmation {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = components(trimmed), isHost(parts, "root-wallet-confirm") else {
            throw ParserError.invalidLink
        }

        let items = parts.queryItems ?? []
        guard let walletId = value(["wallet_id", "walletId"], in: items),
              let token = value(["token"], in: items)
        else {
            throw ParserError.missingRequiredFields
        }

        return AegisRootWalletConfirmation(
            walletId: walletId,
            token: token,
            sourceWebAppURL: value(["vanguard_web_app_url"], in: items),
            rawURL: trimmed
        )
    }

    static func parseBreakGlass(_ rawText: String) throws -> AegisBreakGlassAuthorisation {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = components(trimmed), isHost(parts, "break-glass-authorise") else {
            throw ParserError.invalidLink
        }

        guard let token = value(["token"], in: parts.queryItems ?? []) else {
            throw ParserError.missingRequiredFields
        }

        return AegisBreakGlassAuthorisation(
            token: token,
            sourceWebAppURL: value(["vanguard_web_app_url"], in: parts.queryItems ?? []),
            rawURL: trimmed
        )
    }

    private static func components(_ rawText: String) -> URLComponents? {
        URLComponents(string: rawText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func isHost(_ parts: URLComponents, _ host: String) -> Bool {
        guard AegisWalletEnvironment.isAegisScheme(parts.scheme) else {
            return false
        }
        return parts.host?.lowercased() == host || parts.path.lowercased().contains(host)
    }

    private static func value(_ names: [String], in items: [URLQueryItem]) -> String? {
        for name in names {
            if let found = items.first(where: { $0.name == name })?.value, !found.isEmpty {
                return found
            }
        }
        return nil
    }

    enum ParserError: LocalizedError {
        case invalidLink
        case missingRequiredFields

        var errorDescription: String? {
            switch self {
            case .invalidLink:
                return "That QR code is not an Aegis root wallet link."
            case .missingRequiredFields:
                return "This root wallet link is missing its confirmation token."
            }
        }
    }
}

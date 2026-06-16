import Foundation

enum OOBInvitationParser {
    static func parse(_ rawText: String) throws -> AriesInvitation {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
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
            rawURL: trimmed,
            endpoint: endpoint,
            handshakeProtocols: payload.handshakeProtocols ?? [],
            services: payload.services?.map(\.value) ?? [],
            receivedAt: Date()
        )
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

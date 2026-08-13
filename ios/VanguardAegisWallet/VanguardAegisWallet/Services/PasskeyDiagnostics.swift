import Foundation

/// What the extension did, so a failure can be read rather than guessed at.
///
/// A credential provider extension is launched by the system, has no console a
/// holder can reach, and every failure reaches the site as the same sentence:
/// "the request is not allowed by the user agent or the platform". That message
/// is identical for a malformed credential, a keychain refusal and a timeout,
/// which makes it useless for telling those apart.
///
/// This writes the last few events into the shared container so the app can
/// show them. It records what happened and why — never a challenge, a key, or
/// anything a relying party sent.
enum PasskeyDiagnostics {
    private static let fileName = "passkey-log.json"
    private static let limit = 40

    struct Entry: Codable, Identifiable {
        var id: String { "\(at.timeIntervalSince1970)-\(event)" }
        var at: Date
        var event: String
        var detail: String
    }

    static func record(_ event: String, detail: String = "") {
        guard let url else { return }
        var entries = read()
        entries.insert(Entry(at: Date(), event: event, detail: detail), at: 0)
        if entries.count > limit {
            entries = Array(entries.prefix(limit))
        }
        if let data = try? encoder.encode(entries) {
            try? data.write(to: url, options: .atomic)
        }
    }

    static func read() -> [Entry] {
        guard let url, let data = try? Data(contentsOf: url) else { return [] }
        return (try? decoder.decode([Entry].self, from: data)) ?? []
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: PasskeyStore.appGroup)?
            .appendingPathComponent(fileName)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

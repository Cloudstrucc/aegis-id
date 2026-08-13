import Foundation

/// One passkey this wallet holds for one relying party.
///
/// The private key is not here — it is in the keychain, keyed by credentialId.
/// This is the part the holder can be shown: which site, which account, when it
/// was made and when it was last used.
struct StoredPasskey: Codable, Identifiable, Equatable {
    var id: String { credentialId }

    /// base64url, because it has to survive JSON and be compared against what
    /// the relying party sends back.
    var credentialId: String
    var rpId: String
    var rpName: String
    var userHandle: String
    var userName: String
    var userDisplayName: String
    var signCount: UInt32
    var createdAt: Date
    var lastUsedAt: Date?

    var credentialIdData: Data {
        Data(base64URLEncoded: credentialId) ?? Data()
    }

    var userHandleData: Data {
        Data(base64URLEncoded: userHandle) ?? Data()
    }

    /// What to show when a site sent no display name, which many do not.
    var accountLabel: String {
        if !userDisplayName.isEmpty { return userDisplayName }
        if !userName.isEmpty { return userName }
        return rpId
    }
}

/// The passkeys, shared between the app and the credential provider extension.
///
/// Two processes read this: the app, to list them, and the extension, which the
/// system launches on its own whenever a site asks for a passkey. That is why
/// it lives in the App Group container rather than the app's own sandbox —
/// UserDefaults.standard in the extension is a different, empty store.
final class PasskeyStore {
    static let appGroup = "group.ca.vanguardcs.aegisid.wallet"
    static let shared = PasskeyStore()

    private let fileName = "passkeys.json"
    private let queue = DispatchQueue(label: "ca.vanguardcs.aegisid.passkey-store")

    private var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
            .appendingPathComponent(fileName)
    }

    func all() -> [StoredPasskey] {
        queue.sync {
            guard let url, let data = try? Data(contentsOf: url) else { return [] }
            return (try? JSONDecoder.passkey.decode([StoredPasskey].self, from: data)) ?? []
        }
    }

    /// Every passkey for a relying party, newest first — what a site's "choose
    /// an account" list is built from.
    func passkeys(forRpId rpId: String) -> [StoredPasskey] {
        all()
            .filter { $0.rpId.caseInsensitiveCompare(rpId) == .orderedSame }
            .sorted { ($0.lastUsedAt ?? $0.createdAt) > ($1.lastUsedAt ?? $1.createdAt) }
    }

    func passkey(credentialId: String) -> StoredPasskey? {
        all().first { $0.credentialId == credentialId }
    }

    func save(_ passkey: StoredPasskey) {
        mutate { records in
            records.removeAll { $0.credentialId == passkey.credentialId }
            records.append(passkey)
        }
    }

    /// Record a use and move the counter on.
    ///
    /// The signature counter is how a relying party spots a cloned
    /// authenticator: it must never go backwards for a given credential, so it
    /// is incremented here on every assertion rather than derived from anything
    /// that could be replayed.
    @discardableResult
    func recordUse(credentialId: String) -> UInt32 {
        var next: UInt32 = 0
        mutate { records in
            guard let index = records.firstIndex(where: { $0.credentialId == credentialId }) else { return }
            records[index].signCount &+= 1
            records[index].lastUsedAt = Date()
            next = records[index].signCount
        }
        return next
    }

    /// Forget a passkey, key included.
    ///
    /// The relying party still believes it exists — deleting here cannot tell
    /// them — so the interface has to say that plainly rather than implying the
    /// account has been cleaned up.
    func delete(credentialId: String) {
        if let data = Data(base64URLEncoded: credentialId) {
            PasskeyKeyStore.deleteKey(for: data)
        }
        mutate { records in
            records.removeAll { $0.credentialId == credentialId }
        }
    }

    func deleteAll() {
        for record in all() {
            PasskeyKeyStore.deleteKey(for: record.credentialIdData)
        }
        mutate { $0.removeAll() }
    }

    private func mutate(_ change: (inout [StoredPasskey]) -> Void) {
        queue.sync {
            guard let url else { return }
            var records: [StoredPasskey] = []
            if let data = try? Data(contentsOf: url) {
                records = (try? JSONDecoder.passkey.decode([StoredPasskey].self, from: data)) ?? []
            }
            change(&records)
            if let encoded = try? JSONEncoder.passkey.encode(records) {
                try? encoded.write(to: url, options: .atomic)
            }
        }
    }
}

private extension JSONDecoder {
    static let passkey: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

private extension JSONEncoder {
    static let passkey: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

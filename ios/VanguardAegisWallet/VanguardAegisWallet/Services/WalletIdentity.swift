import Foundation

// Wallet ID parsing/validation, mirroring src/services/wallet-id.js exactly so
// the app can reject a mistyped or mismatched ID before contacting the server.
//
// Format: AEG-XXXX-XXXX-XXXX-XXXX (16 significant Crockford Base32 characters,
// final character is a mod-37 check symbol).
enum WalletIdFormat {
    static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let prefix = "AEG"
    static let totalLength = 16
    private static let bodyLength = 15
    private static let checkModulus = 37

    /// Strip formatting and map the characters people commonly substitute.
    static func normalizeInput(_ value: String) -> String {
        var significant = value.uppercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
        if significant.hasPrefix(prefix) {
            significant = String(significant.dropFirst(prefix.count))
        }
        return significant
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "U", with: "V")
    }

    static func checkSymbol(body: String) -> Character? {
        var sum = 0
        for (index, character) in body.enumerated() {
            guard let value = alphabet.firstIndex(of: character) else {
                return nil
            }
            sum += value * (index + 2)
        }
        let residue = sum % checkModulus
        return residue < alphabet.count ? alphabet[residue] : nil
    }

    static func format(significant: String) -> String {
        var groups: [String] = []
        var current = ""
        for character in significant {
            current.append(character)
            if current.count == 4 {
                groups.append(current)
                current = ""
            }
        }
        if !current.isEmpty {
            groups.append(current)
        }
        return "\(prefix)-\(groups.joined(separator: "-"))"
    }

    /// Canonical `AEG-XXXX-XXXX-XXXX-XXXX`, or nil when structurally invalid.
    static func parse(_ value: String) -> String? {
        let significant = normalizeInput(value)
        guard significant.count == totalLength else {
            return nil
        }
        guard significant.allSatisfy({ alphabet.contains($0) }) else {
            return nil
        }

        let body = String(significant.prefix(bodyLength))
        guard let expected = checkSymbol(body: body),
              expected == Array(significant)[bodyLength] else {
            return nil
        }
        return format(significant: significant)
    }

    static func isValid(_ value: String) -> Bool {
        parse(value) != nil
    }

    /// True when two Wallet IDs refer to the same wallet, ignoring formatting.
    static func matches(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhs, let rhs, let a = parse(lhs), let b = parse(rhs) else {
            return false
        }
        return a == b
    }
}

/// The holder's registered wallet identity, persisted on the device.
struct WalletIdentityRecord: Codable, Equatable {
    var walletId: String
    var email: String
    var phone: String?
    var deviceKeyId: String
    var registeredAt: Date
}

import Foundation
import CryptoKit
import LocalAuthentication
import Security

/// How the wallet is locked between uses.
///
/// A wallet holds credentials and can approve sign-ins with a tap, so the app
/// itself needs a lock — the phone being unlocked is not the same as *this
/// person* being at the wallet. Two choices, set during setup:
///
///  - `.pin`       a numeric PIN this app checks (a salted, iterated hash in
///                 the Keychain, never the PIN itself)
///  - `.biometric` Face ID / Touch ID, or the device passcode as the OS
///                 fallback — the platform authenticator, i.e. the device's
///                 own passkey/biometric
enum WalletLockMethod: String, Codable {
    case none
    case pin
    case biometric
}

/// Keychain-backed lock configuration. Separate from the wallet identity so it
/// can be read cheaply on every launch and changed without touching the
/// identity record.
enum WalletLock {
    private static let service = "ca.vanguardcs.aegisid.wallet.lock"
    private static let iterations = 120_000

    struct Stored: Codable {
        var method: WalletLockMethod
        var salt: Data?
        var hash: Data?
    }

    // MARK: Reading

    static var method: WalletLockMethod {
        load()?.method ?? .none
    }

    static var isConfigured: Bool {
        method != .none
    }

    // MARK: Setting

    static func setPin(_ pin: String) {
        let salt = randomSalt()
        let hash = derive(pin: pin, salt: salt)
        save(Stored(method: .pin, salt: salt, hash: hash))
    }

    static func setBiometric() {
        save(Stored(method: .biometric, salt: nil, hash: nil))
    }

    static func clear() {
        SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service
        ] as CFDictionary)
    }

    // MARK: Verifying

    /// Constant-time check of a PIN against the stored hash.
    static func verifyPin(_ pin: String) -> Bool {
        guard let stored = load(), stored.method == .pin,
              let salt = stored.salt, let expected = stored.hash else {
            return false
        }
        let candidate = derive(pin: pin, salt: salt)
        return constantTimeEquals(candidate, expected)
    }

    /// Whether the device can do biometrics or a passcode right now.
    static func biometricsAvailable() -> Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Prompt Face ID / Touch ID / passcode. Throws on cancel or failure.
    static func evaluateBiometric(reason: String) async throws {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            throw LockError.unavailable
        }
        let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        guard ok else { throw LockError.failed }
    }

    enum LockError: LocalizedError {
        case unavailable
        case failed

        var errorDescription: String? {
            switch self {
            case .unavailable: return "This device has no Face ID, Touch ID or passcode set up."
            case .failed: return "You were not verified."
            }
        }
    }

    // MARK: Internals

    private static func derive(pin: String, salt: Data) -> Data {
        // Iterated SHA-256 over salt||pin. A PIN's strength comes mostly from
        // the Keychain's own protection and the app's attempt limit; this makes
        // an offline guess of a leaked blob costly rather than instant.
        var value = Data(salt)
        value.append(Data(pin.utf8))
        var digest = SHA256.hash(data: value)
        for _ in 1..<iterations {
            digest = SHA256.hash(data: Data(digest))
        }
        return Data(digest)
    }

    private static func randomSalt() -> Data {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    private static func constantTimeEquals(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for (x, y) in zip(a, b) { difference |= x ^ y }
        return difference == 0
    }

    private static func load() -> Stored? {
        var item: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ] as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Stored.self, from: data)
    }

    private static func save(_ stored: Stored) {
        guard let data = try? JSONEncoder().encode(stored) else { return }
        SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service
        ] as CFDictionary)
        SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData: data
        ] as CFDictionary, nil)
    }
}

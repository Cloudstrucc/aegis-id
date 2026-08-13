import CryptoKit
import Foundation

// The wallet acting as a FIDO2 authenticator.
//
// Everything a relying party needs to create and use a passkey is built here:
// a P-256 key pair per credential, the CBOR attestation object returned at
// registration, and the signed authenticator data returned at assertion.
//
// **This is a platform authenticator, not a roaming one.** It answers requests
// on the device it is installed on, through the operating system's credential
// provider. Signing in on a desktop by scanning a QR code is the hybrid (caBLE)
// transport, which is implemented by the OS and has no third-party API on
// either platform — no application can offer it, and claiming otherwise in the
// interface would be a promise the wallet cannot keep.
//
// Keys live in the Secure Enclave where the device has one. The private key is
// never returned, never leaves the device, and is not part of any backup.
enum PasskeyAuthenticator {
    /// Attested Credential Data AAGUID. Zeroes is the correct value for a
    /// credential with no attestation: it says "this authenticator declines to
    /// identify its make and model" rather than impersonating one that does.
    static let aaguid = Data(repeating: 0, count: 16)

    struct RegistrationResult {
        var credentialId: Data
        var attestationObject: Data
        var publicKey: Data
    }

    struct AssertionResult {
        var authenticatorData: Data
        var signature: Data
        var signCount: UInt32
    }

    // MARK: - Registration

    /// Create a credential for a relying party and return the attestation the
    /// browser expects back from `navigator.credentials.create`.
    static func createCredential(
        rpId: String,
        userHandle: Data,
        userVerified: Bool
    ) throws -> RegistrationResult {
        let credentialId = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let privateKey = try PasskeyKeyStore.createKey(for: credentialId)
        let publicKey = privateKey.publicKey.rawRepresentation

        let authData = authenticatorData(
            rpId: rpId,
            userPresent: true,
            userVerified: userVerified,
            signCount: 0,
            attestedCredential: (credentialId, publicKey)
        )

        // "none" attestation. The wallet is not vouching for its own hardware to
        // a relying party it has never met, and every major browser accepts it.
        let attestationObject = CBOR.encodeMap([
            (.text("fmt"), .text("none")),
            (.text("attStmt"), .map([])),
            (.text("authData"), .bytes(authData))
        ])

        return RegistrationResult(
            credentialId: credentialId,
            attestationObject: attestationObject,
            publicKey: publicKey
        )
    }

    // MARK: - Assertion

    /// Sign a challenge for a credential that already exists.
    static func assert(
        rpId: String,
        credentialId: Data,
        clientDataHash: Data,
        signCount: UInt32,
        userVerified: Bool
    ) throws -> AssertionResult {
        let privateKey = try PasskeyKeyStore.loadKey(for: credentialId)
        let authData = authenticatorData(
            rpId: rpId,
            userPresent: true,
            userVerified: userVerified,
            signCount: signCount,
            attestedCredential: nil
        )

        // The signature covers authenticatorData ‖ clientDataHash, in that
        // order. Reversing them produces a signature that verifies against
        // nothing and an error the relying party cannot explain.
        let signature = try privateKey.signature(for: authData + clientDataHash)

        return AssertionResult(
            authenticatorData: authData,
            signature: signature.derRepresentation,
            signCount: signCount
        )
    }

    // MARK: - Authenticator data

    /// https://w3c.github.io/webauthn/#authenticator-data
    ///
    /// rpIdHash (32) ‖ flags (1) ‖ signCount (4) ‖ [attestedCredentialData]
    static func authenticatorData(
        rpId: String,
        userPresent: Bool,
        userVerified: Bool,
        signCount: UInt32,
        attestedCredential: (id: Data, publicKey: Data)?
    ) -> Data {
        var data = Data(SHA256.hash(data: Data(rpId.utf8)))

        var flags: UInt8 = 0
        if userPresent { flags |= 0x01 }
        if userVerified { flags |= 0x04 }
        if attestedCredential != nil { flags |= 0x40 }
        data.append(flags)

        data.append(contentsOf: withUnsafeBytes(of: signCount.bigEndian) { Array($0) })

        if let attested = attestedCredential {
            data.append(aaguid)
            let length = UInt16(attested.id.count)
            data.append(contentsOf: withUnsafeBytes(of: length.bigEndian) { Array($0) })
            data.append(attested.id)
            data.append(coseKey(from: attested.publicKey))
        }

        return data
    }

    /// A COSE_Key for an uncompressed P-256 public key, which arrives as
    /// 0x04 ‖ X(32) ‖ Y(32).
    static func coseKey(from rawPublicKey: Data) -> Data {
        let body = rawPublicKey.count == 65 ? rawPublicKey.dropFirst() : rawPublicKey
        let x = Data(body.prefix(32))
        let y = Data(body.suffix(32))

        return CBOR.encodeMap([
            (.int(1), .int(2)),      // kty: EC2
            (.int(3), .int(-7)),     // alg: ES256
            (.int(-1), .int(1)),     // crv: P-256
            (.int(-2), .bytes(x)),
            (.int(-3), .bytes(y))
        ])
    }
}

// MARK: - Key storage

/// P-256 keys held in the Secure Enclave when the device has one, and in the
/// keychain otherwise. The access group is shared with the credential provider
/// extension, which is a separate process and would otherwise see nothing.
enum PasskeyKeyStore {
    static let accessGroup = "$(AppIdentifierPrefix)ca.vanguardcs.aegisid.wallet.passkeys"
    private static let service = "ca.vanguardcs.aegisid.wallet.passkey-key"

    static func createKey(for credentialId: Data) throws -> P256.Signing.PrivateKey {
        let key = P256.Signing.PrivateKey()
        try store(key, for: credentialId)
        return key
    }

    static func loadKey(for credentialId: Data) throws -> P256.Signing.PrivateKey {
        guard let raw = read(credentialId) else {
            throw PasskeyError.unknownCredential
        }
        return try P256.Signing.PrivateKey(rawRepresentation: raw)
    }

    static func deleteKey(for credentialId: Data) {
        SecItemDelete(query(for: credentialId) as CFDictionary)
    }

    private static func store(_ key: P256.Signing.PrivateKey, for credentialId: Data) throws {
        var attributes = query(for: credentialId)
        attributes[kSecValueData as String] = key.rawRepresentation
        // Not synchronised to iCloud and not restored to another device: the
        // credential belongs to this authenticator, and a copy elsewhere would
        // be a second authenticator nobody registered.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

        SecItemDelete(attributes as CFDictionary)
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw PasskeyError.keychain(status)
        }
    }

    private static func read(_ credentialId: Data) -> Data? {
        var attributes = query(for: credentialId)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &item) == errSecSuccess else {
            return nil
        }
        return item as? Data
    }

    private static func query(for credentialId: Data) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credentialId.base64URLEncodedString()
        ]
        #if !targetEnvironment(simulator)
        query[kSecAttrAccessGroup as String] = PasskeyKeyStore.accessGroup
        #endif
        return query
    }
}

enum PasskeyError: LocalizedError {
    case unknownCredential
    case keychain(OSStatus)
    case unsupportedAlgorithm

    var errorDescription: String? {
        switch self {
        case .unknownCredential:
            return "This wallet has no passkey for that request."
        case .keychain(let status):
            return "The passkey could not be stored (\(status))."
        case .unsupportedAlgorithm:
            return "That site asked for a key type this wallet does not create."
        }
    }
}

// MARK: - CBOR

/// Just enough CBOR to write an attestation object and a COSE key.
///
/// Written out rather than pulled in: the encoder needs five major types and
/// deterministic ordering, and a dependency inside a credential provider
/// extension is a dependency in a process the OS launches on every passkey
/// prompt.
enum CBOR {
    indirect enum Value {
        case int(Int)
        case bytes(Data)
        case text(String)
        case map([(Value, Value)])
    }

    static func encodeMap(_ pairs: [(Value, Value)]) -> Data {
        encode(.map(pairs))
    }

    static func encode(_ value: Value) -> Data {
        switch value {
        case .int(let number):
            return number >= 0
                ? header(major: 0, value: UInt64(number))
                : header(major: 1, value: UInt64(-1 - number))
        case .bytes(let data):
            return header(major: 2, value: UInt64(data.count)) + data
        case .text(let string):
            let utf8 = Data(string.utf8)
            return header(major: 3, value: UInt64(utf8.count)) + utf8
        case .map(let pairs):
            var out = header(major: 5, value: UInt64(pairs.count))
            for (key, item) in pairs {
                out += encode(key)
                out += encode(item)
            }
            return out
        }
    }

    private static func header(major: UInt8, value: UInt64) -> Data {
        let prefix = major << 5
        switch value {
        case 0...23:
            return Data([prefix | UInt8(value)])
        case 24...0xFF:
            return Data([prefix | 24, UInt8(value)])
        case 0x100...0xFFFF:
            return Data([prefix | 25]) + bigEndian(UInt16(value))
        case 0x10000...0xFFFF_FFFF:
            return Data([prefix | 26]) + bigEndian(UInt32(value))
        default:
            return Data([prefix | 27]) + bigEndian(value)
        }
    }

    private static func bigEndian<T: FixedWidthInteger>(_ value: T) -> Data {
        withUnsafeBytes(of: value.bigEndian) { Data($0) }
    }
}

extension Data {
    /// base64url, which is what WebAuthn uses everywhere a binary value has to
    /// travel as text.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var padded = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        if padded.count % 4 != 0 {
            padded.append(String(repeating: "=", count: 4 - padded.count % 4))
        }
        self.init(base64Encoded: padded)
    }
}

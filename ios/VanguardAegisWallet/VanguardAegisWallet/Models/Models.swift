import Foundation

struct AriesInvitation: Codable, Equatable, Hashable, Identifiable {
    var id: String
    var label: String
    var rawURL: String
    var endpoint: String?
    var organizationId: String?
    var organizationName: String?
    var subscriptionId: String?
    var handshakeProtocols: [String]
    var services: [String]
    var receivedAt: Date
}

struct WalletConnection: Codable, Equatable, Hashable, Identifiable {
    var id: UUID
    var invitation: AriesInvitation
    var state: WalletConnectionState
    var holderConnectionId: String?
    var issuerConnectionId: String?
    var createdAt: Date
    var updatedAt: Date

    init(invitation: AriesInvitation) {
        self.id = UUID()
        self.invitation = invitation
        self.state = .invitationReceived
        self.holderConnectionId = nil
        self.issuerConnectionId = nil
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

struct CredentialOrganization: Identifiable, Hashable {
    var id: String
    var name: String
    var connectionCount: Int
    var credentialCount: Int
    var challengeCount: Int
    var latestState: WalletConnectionState
    var latestUpdatedAt: Date
}

struct WalletChallengeBanner: Identifiable, Equatable {
    var id = UUID()
    var count: Int
    var title: String
    var detail: String
    var receivedAt = Date()
}

struct OrganizationProfile: Codable, Equatable, Identifiable {
    var organizationId: String
    var organizationName: String
    var branding: OrganizationBranding
    var roles: [OrganizationRole]
    var claimDefinitions: [OrganizationClaimDefinition]
    var orgUnits: [OrganizationUnit]?
    var credentials: [OrganizationCredential]

    var id: String { organizationId }
}

struct OrganizationBranding: Codable, Equatable {
    var paletteId: String
    var primaryColor: String
    var accentColor: String
    var backgroundColor: String
    var textColor: String
    var logoDataUrl: String?
}

struct OrganizationRole: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String?
}

struct OrganizationClaimDefinition: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var key: String
    var label: String
    var type: String
    var required: Bool?
    var defaultValue: String?
}

struct OrganizationUnit: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var name: String
    var parentId: String?
    var description: String?
    var roleIds: [String]?
    var claimKeys: [String]?
    var depth: Int?
    var path: String?
    var credentialCount: Int?
}

struct OrganizationCredential: Codable, Equatable, Identifiable {
    var id: String
    var holderEmail: String
    var displayName: String
    var personType: String?
    var divisionId: String?
    var divisionName: String?
    var status: String
    var inviteTtlDays: Int?
    var inviteExpiresAt: String?
    var inviteExpired: Bool?
    var roles: [OrganizationRole]
    var claims: [String: String]
    var consent: OrganizationClaimConsent?
    var coAdminStatus: String?
    var updatedAt: String?
}

struct OrganizationClaimConsent: Codable, Equatable {
    var status: String
    var requestedClaimKeys: [String]
    var sharedClaims: [String: String]
    var deltaClaims: [String]?
    var requestedAt: String?
    var grantedAt: String?
}

enum WalletConnectionState: String, Codable, Hashable, CaseIterable {
    case invitationReceived
    case readyForDidExchange
    case connected
    case credentialOffered
    case challengeReceived
    case disabled
    case failed

    var title: String {
        switch self {
        case .invitationReceived:
            return "Invitation received"
        case .readyForDidExchange:
            return "Ready for DID exchange"
        case .connected:
            return "Connected"
        case .credentialOffered:
            return "Credential offered"
        case .challengeReceived:
            return "Challenge received"
        case .disabled:
            return "Disabled"
        case .failed:
            return "Needs attention"
        }
    }

    var symbolName: String {
        switch self {
        case .invitationReceived:
            return "tray.and.arrow.down"
        case .readyForDidExchange:
            return "arrow.triangle.2.circlepath"
        case .connected:
            return "checkmark.seal"
        case .credentialOffered:
            return "person.text.rectangle"
        case .challengeReceived:
            return "bolt.shield"
        case .disabled:
            return "lock.slash"
        case .failed:
            return "exclamationmark.triangle"
        }
    }
}

struct WalletTransaction: Codable, Equatable, Hashable, Identifiable {
    var id: UUID
    var connectionId: UUID
    var type: WalletTransactionType
    var status: WalletTransactionStatus
    var title: String
    var detail: String
    var remoteId: String?
    var webSessionId: String?
    var webAcceptPath: String?
    var appName: String?
    var action: String?
    var resourceType: String?
    var resourceId: String?
    var requiresPasskey: Bool?
    var requiredAssurance: String?
    var passkeyAcceptPath: String?
    var passkeyEvidenceLabel: String?
    var payloadFields: [WalletChallengePayloadField]?
    var createdAt: Date
    var updatedAt: Date

    init(
        connectionId: UUID,
        type: WalletTransactionType,
        status: WalletTransactionStatus,
        title: String,
        detail: String,
        remoteId: String? = nil,
        webSessionId: String? = nil,
        webAcceptPath: String? = nil,
        appName: String? = nil,
        action: String? = nil,
        resourceType: String? = nil,
        resourceId: String? = nil,
        requiresPasskey: Bool = false,
        requiredAssurance: String? = nil,
        passkeyAcceptPath: String? = nil,
        passkeyEvidenceLabel: String? = nil,
        payloadFields: [WalletChallengePayloadField]? = nil
    ) {
        self.id = UUID()
        self.connectionId = connectionId
        self.type = type
        self.status = status
        self.title = title
        self.detail = detail
        self.remoteId = remoteId
        self.webSessionId = webSessionId
        self.webAcceptPath = webAcceptPath
        self.appName = appName
        self.action = action
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.requiresPasskey = requiresPasskey
        self.requiredAssurance = requiredAssurance
        self.passkeyAcceptPath = passkeyAcceptPath
        self.passkeyEvidenceLabel = passkeyEvidenceLabel
        self.payloadFields = payloadFields
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

struct WalletChallengePayloadField: Codable, Equatable, Hashable, Identifiable {
    var key: String
    var value: String

    var id: String { key }
}

enum WalletTransactionType: String, Codable, Hashable, CaseIterable {
    case invitation
    case credential
    case challenge
    case message

    var symbolName: String {
        switch self {
        case .invitation:
            return "link.badge.plus"
        case .credential:
            return "person.text.rectangle"
        case .challenge:
            return "bolt.shield"
        case .message:
            return "bubble.left.and.bubble.right"
        }
    }
}

enum WalletTransactionStatus: String, Codable, Hashable, CaseIterable {
    case received
    case pendingAcceptance
    case accepted
    case sent
    case failed

    var title: String {
        switch self {
        case .received:
            return "Received"
        case .pendingAcceptance:
            return "Pending acceptance"
        case .accepted:
            return "Accepted"
        case .sent:
            return "Sent"
        case .failed:
            return "Failed"
        }
    }
}

struct WalletPasskeyStatus: Codable, Equatable {
    var subject: String
    var displayName: String
    var passkeyCount: Int
    var lastRegisteredAt: String?
    var lastAuthenticatedAt: String?
}

struct WalletPasskeyOptionsEnvelope: Codable, Equatable {
    var subject: String
    var challengeId: String?
    var options: WalletPasskeyOptions
}

struct WalletPasskeyOptions: Codable, Equatable {
    var challenge: String
    var rp: WalletPasskeyRelyingParty?
    var user: WalletPasskeyUser?
    var timeout: Int?
}

struct WalletPasskeyRelyingParty: Codable, Equatable {
    var id: String?
    var name: String?
}

struct WalletPasskeyUser: Codable, Equatable {
    var id: String?
    var name: String?
    var displayName: String?
}

struct WalletPasskeyCeremonyResponse: Codable, Equatable {
    var id: String
    var rawId: String
    var type: String
    var authenticatorAttachment: String?
    var response: WalletPasskeyAuthenticatorResponse
}

struct WalletPasskeyAuthenticatorResponse: Codable, Equatable {
    var clientDataJSON: String
    var attestationObject: String?
    var authenticatorData: String?
    var signature: String?
    var userHandle: String?
    var transports: [String]?
}

struct WalletPasskeyVerificationEnvelope: Codable, Equatable {
    var ok: Bool
    var status: WalletPasskeyStatus?
    var evidence: WalletPasskeyEvidence?
}

struct WalletPasskeyEvidence: Codable, Equatable {
    var subject: String
    var assurance: String
    var userVerified: Bool
    var credentialId: String
    var rpId: String
    var origin: String
    var challengeId: String?
    var verifiedAt: String
}

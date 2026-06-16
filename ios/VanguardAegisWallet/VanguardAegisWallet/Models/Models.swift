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

struct OrganizationProfile: Codable, Equatable, Identifiable {
    var organizationId: String
    var organizationName: String
    var branding: OrganizationBranding
    var roles: [OrganizationRole]
    var claimDefinitions: [OrganizationClaimDefinition]
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

struct OrganizationCredential: Codable, Equatable, Identifiable {
    var id: String
    var holderEmail: String
    var displayName: String
    var status: String
    var roles: [OrganizationRole]
    var claims: [String: String]
    var coAdminStatus: String?
    var updatedAt: String?
}

enum WalletConnectionState: String, Codable, Hashable, CaseIterable {
    case invitationReceived
    case readyForDidExchange
    case connected
    case credentialOffered
    case challengeReceived
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
    var createdAt: Date
    var updatedAt: Date

    init(
        connectionId: UUID,
        type: WalletTransactionType,
        status: WalletTransactionStatus,
        title: String,
        detail: String,
        remoteId: String? = nil,
        webSessionId: String? = nil
    ) {
        self.id = UUID()
        self.connectionId = connectionId
        self.type = type
        self.status = status
        self.title = title
        self.detail = detail
        self.remoteId = remoteId
        self.webSessionId = webSessionId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
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

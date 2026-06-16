import SwiftUI
import UIKit

struct OrganizationsView: View {
    @EnvironmentObject private var store: WalletStore

    var body: some View {
        List {
            if store.credentialOrganizations.isEmpty {
                ContentUnavailableView(
                    "No credential organizations",
                    systemImage: "building.2.crop.circle",
                    description: Text("Accept a Vanguard Aegis ID issuer invitation to see the organizations you hold credentials or wallet challenges for.")
                )
            } else {
                Section("Credential organizations") {
                    ForEach(store.credentialOrganizations) { organization in
                        NavigationLink {
                            OrganizationDetailView(
                                organization: organization,
                                profile: store.organizationProfile(for: organization.id),
                                transactions: store.transactions(forOrganizationId: organization.id)
                            )
                        } label: {
                            OrganizationRow(
                                organization: organization,
                                profile: store.organizationProfile(for: organization.id)
                            )
                        }
                    }
                }
            }
        }
        .navigationTitle("Organizations")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await store.refreshOrganizationProfiles() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh organization profiles")
            }
        }
        .task {
            await store.refreshOrganizationProfiles()
        }
    }
}

private struct OrganizationRow: View {
    var organization: CredentialOrganization
    var profile: OrganizationProfile?

    var body: some View {
        HStack(spacing: 14) {
            OrganizationLogo(profile: profile, fallbackName: organization.name, size: 46)

            VStack(alignment: .leading, spacing: 5) {
                Text(profile?.organizationName ?? organization.name)
                    .font(.headline)
                Text(organization.latestState.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text("\(organization.connectionCount) connection\(organization.connectionCount == 1 ? "" : "s")")
                    Text("\(organization.challengeCount) challenge\(organization.challengeCount == 1 ? "" : "s")")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: organization.latestState.symbolName)
                .foregroundStyle(statusTint)
        }
        .padding(.vertical, 4)
    }

    private var statusTint: Color {
        switch organization.latestState {
        case .connected, .credentialOffered:
            return VanguardTheme.green
        case .challengeReceived, .readyForDidExchange:
            return VanguardTheme.blue
        case .disabled:
            return .gray
        case .failed:
            return .red
        case .invitationReceived:
            return VanguardTheme.cyan
        }
    }
}

private struct OrganizationDetailView: View {
    @EnvironmentObject private var store: WalletStore

    var organization: CredentialOrganization
    var profile: OrganizationProfile?
    var transactions: [WalletTransaction]

    var body: some View {
        List {
            Section {
                OrganizationBrandHeader(organization: organization, profile: profile)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            Section("Wallet dashboard") {
                OrganizationMetricRow(value: organization.connectionCount, label: "Connections", systemImage: "link")
                OrganizationMetricRow(value: profile?.credentials.count ?? organization.credentialCount, label: "Issued credentials", systemImage: "person.text.rectangle")
                OrganizationMetricRow(value: transactions.filter { $0.status == .pendingAcceptance }.count, label: "Pending actions", systemImage: "bolt.shield")
            }

            if let profile {
                if organization.latestState == .disabled {
                    Section {
                        Label {
                            Text("This organization is disabled in your wallet because its credential access has been revoked. It remains visible for audit history and portability.")
                                .font(.subheadline)
                        } icon: {
                            Image(systemName: "lock.slash")
                                .foregroundStyle(.red)
                        }
                    }
                }

                let units = profile.orgUnits ?? []
                if !units.isEmpty {
                    Section("Organization structure") {
                        ForEach(units) { unit in
                            OrgUnitRow(unit: unit, roles: profile.roles, claims: profile.claimDefinitions)
                        }
                    }
                }

                Section("Credentials and claims") {
                    ForEach(profile.credentials) { credential in
                        CredentialProfileCard(credential: credential, claimDefinitions: profile.claimDefinitions)
                    }
                }

                Section("Organization roles") {
                    ForEach(profile.roles) { role in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(role.name)
                                .font(.headline)
                            if let description = role.description, !description.isEmpty {
                                Text(description)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Section {
                    ContentUnavailableView(
                        "Profile not synced",
                        systemImage: "arrow.triangle.2.circlepath",
                        description: Text("Tap refresh to pull roles, claims, credential status, and branding from the web dashboard.")
                    )
                }
            }

            Section("Recent wallet transactions") {
                if transactions.isEmpty {
                    Text("No wallet transactions for this organization yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(transactions.prefix(8)) { transaction in
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(transaction.title)
                                    .font(.subheadline.weight(.semibold))
                                Text(transaction.status.title)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: transaction.type.symbolName)
                                .foregroundStyle(VanguardTheme.blue)
                        }
                    }
                }
            }
        }
        .navigationTitle(profile?.organizationName ?? organization.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await store.refreshOrganizationProfile(organizationId: organization.id) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh organization profile")
            }
        }
    }
}

private struct OrganizationBrandHeader: View {
    var organization: CredentialOrganization
    var profile: OrganizationProfile?

    var body: some View {
        let branding = profile?.branding
        let primary = Color(hex: branding?.primaryColor, fallback: VanguardTheme.blue)
        let accent = Color(hex: branding?.accentColor, fallback: VanguardTheme.green)
        let background = Color(hex: branding?.backgroundColor, fallback: VanguardTheme.mist)
        let text = Color(hex: branding?.textColor, fallback: VanguardTheme.ink)

        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                OrganizationLogo(profile: profile, fallbackName: organization.name, size: 68)

                VStack(alignment: .leading, spacing: 6) {
                    Text(profile?.organizationName ?? organization.name)
                        .font(.title2.bold())
                        .foregroundStyle(text)
                    Text("Aegis ID credential context")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(text.opacity(0.72))
                }

                Spacer()
            }

            HStack(spacing: 8) {
                StatusBadge(text: organization.latestState.title, systemImage: organization.latestState.symbolName, tint: primary)
                StatusBadge(text: "Holder view", systemImage: "person.crop.circle.badge.checkmark", tint: accent)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [background, accent.opacity(0.18)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(primary.opacity(0.22))
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct OrganizationLogo: View {
    var profile: OrganizationProfile?
    var fallbackName: String
    var size: CGFloat

    var body: some View {
        let branding = profile?.branding
        let primary = Color(hex: branding?.primaryColor, fallback: VanguardTheme.blue)
        let accent = Color(hex: branding?.accentColor, fallback: VanguardTheme.green)

        ZStack {
            if let image = imageFromDataUrl(branding?.logoDataUrl) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(8)
                    .background(.white)
            } else {
                LinearGradient(colors: [primary, accent], startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(String(fallbackName.prefix(1)).uppercased())
                    .font(.system(size: size * 0.42, weight: .black))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func imageFromDataUrl(_ value: String?) -> UIImage? {
        guard let value, let base64 = value.split(separator: ",").last else {
            return nil
        }
        guard let data = Data(base64Encoded: String(base64)) else {
            return nil
        }
        return UIImage(data: data)
    }
}

private struct OrgUnitRow: View {
    var unit: OrganizationUnit
    var roles: [OrganizationRole]
    var claims: [OrganizationClaimDefinition]

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(unit.depth == 0 ? VanguardTheme.blue : VanguardTheme.green)
                .frame(width: 4, height: 48)
                .padding(.leading, CGFloat(unit.depth ?? 0) * 14)

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(unit.name)
                        .font(.headline)
                    Spacer()
                    Text("\(unit.credentialCount ?? 0)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                }

                if let path = unit.path, !path.isEmpty {
                    Text(path)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                let labels = roleLabels + claimLabels
                if !labels.isEmpty {
                    FlowLayout(items: labels)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var roleLabels: [String] {
        (unit.roleIds ?? []).compactMap { roleId in
            roles.first(where: { $0.id == roleId })?.name
        }
    }

    private var claimLabels: [String] {
        (unit.claimKeys ?? []).map { key in
            claims.first(where: { $0.key == key })?.label ?? key
        }
    }
}

private struct CredentialProfileCard: View {
    var credential: OrganizationCredential
    var claimDefinitions: [OrganizationClaimDefinition]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(credential.displayName)
                        .font(.headline)
                    Text(credential.holderEmail)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(credential.status.capitalized)
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(statusTint.opacity(0.14))
                    .foregroundStyle(statusTint)
                    .clipShape(Capsule())
            }

            if !credential.roles.isEmpty {
                FlowLayout(items: credential.roles.map(\.name))
            }

            VStack(spacing: 8) {
                ProfileInfoRow(label: "Person type", value: credential.personType?.capitalized ?? "Employee")
                ProfileInfoRow(label: "Division", value: credential.divisionName ?? "Organization")
                if let expiresAt = credential.inviteExpiresAt {
                    ProfileInfoRow(label: "Invite expires", value: expiresAt.prefix(10).description)
                }
                if let consent = credential.consent {
                    ProfileInfoRow(label: "Consent", value: consent.status.capitalized)
                    if !consent.requestedClaimKeys.isEmpty {
                        ProfileInfoRow(label: "Requested", value: labels(for: consent.requestedClaimKeys).joined(separator: ", "))
                    }
                    if !consent.sharedClaims.isEmpty {
                        ProfileInfoRow(label: "Shared", value: labels(for: Array(consent.sharedClaims.keys)).joined(separator: ", "))
                    }
                    if let deltaClaims = consent.deltaClaims, !deltaClaims.isEmpty {
                        ProfileInfoRow(label: "Delta", value: labels(for: deltaClaims).joined(separator: ", "))
                    }
                }
            }

            VStack(spacing: 8) {
                ForEach(claimRows, id: \.key) { row in
                    HStack(alignment: .top) {
                        Text(row.label)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.secondary)
                            .frame(width: 118, alignment: .leading)
                        Text(row.value)
                            .font(.caption.weight(.semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var statusTint: Color {
        switch credential.status {
        case "active":
            return VanguardTheme.green
        case "revoked":
            return .red
        case "invited" where credential.inviteExpired == true:
            return .orange
        default:
            return VanguardTheme.blue
        }
    }

    private func labels(for keys: [String]) -> [String] {
        keys.map { key in
            claimDefinitions.first(where: { $0.key == key })?.label ?? key
        }
    }

    private var claimRows: [(key: String, label: String, value: String)] {
        let definitionRows = claimDefinitions.compactMap { definition -> (key: String, label: String, value: String)? in
            guard let value = credential.claims[definition.key], !value.isEmpty else {
                return nil
            }
            return (definition.key, definition.label, value)
        }
        if !definitionRows.isEmpty {
            return definitionRows
        }
        return credential.claims.keys.sorted().map { key in
            (key, key, credential.claims[key] ?? "")
        }
    }
}

private struct OrganizationMetricRow: View {
    var value: Int
    var label: String
    var systemImage: String

    var body: some View {
        Label {
            HStack {
                Text(label)
                Spacer()
                Text("\(value)")
                    .font(.headline)
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(VanguardTheme.blue)
        }
    }
}

private struct ProfileInfoRow: View {
    var label: String
    var value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 118, alignment: .leading)
            Text(value)
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct FlowLayout: View {
    var items: [String]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.caption.bold())
                    .foregroundStyle(VanguardTheme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .frame(maxWidth: .infinity)
                    .background(VanguardTheme.mist)
                    .clipShape(Capsule())
            }
        }
    }
}

#Preview {
    NavigationStack {
        OrganizationsView()
            .environmentObject(WalletStore())
    }
}

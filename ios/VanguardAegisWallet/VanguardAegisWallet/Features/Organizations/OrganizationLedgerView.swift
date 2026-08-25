import SwiftUI

/// One organization's wallet ledger.
///
/// The Ledger tab shows everything the holder has ever answered, across every
/// organization. Inside an organization that is the wrong question: what
/// matters there is what *this* organization has asked for. Same records,
/// filtered to the connections that belong to it.
///
/// Pages rather than rendering the lot. A holder with a long history was
/// previously served every row at once on a screen that shows eight, and the
/// list is the one place in the wallet where history genuinely accumulates.
struct OrganizationLedgerView: View {
    @EnvironmentObject private var store: WalletStore

    var organizationId: String
    var organizationName: String

    /// Rows are cheap, but the whole history is not worth building to show the
    /// first screenful.
    private static let pageSize = 20

    @State private var searchText = ""
    @State private var visibleCount = pageSize

    var body: some View {
        List {
            if matches.isEmpty {
                Section {
                    ContentUnavailableView(
                        searchText.isEmpty ? "Nothing here yet" : "No matches",
                        systemImage: searchText.isEmpty ? "list.bullet.rectangle.portrait" : "magnifyingglass",
                        description: Text(
                            searchText.isEmpty
                                ? "Approvals and credentials from \(organizationName) will appear here."
                                : "No ledger entries match “\(searchText)”."
                        )
                    )
                }
            } else {
                Section {
                    ForEach(page) { transaction in
                        OrganizationLedgerRow(transaction: transaction)
                    }

                    if page.count < matches.count {
                        // Appearing is what asks for the next page, so scrolling
                        // is the only gesture involved.
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .onAppear {
                            visibleCount += Self.pageSize
                        }
                    }
                } header: {
                    Text("\(matches.count) \(matches.count == 1 ? "entry" : "entries")")
                }
            }
        }
        .navigationTitle("Ledger")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search this organization's ledger")
        // A new search starts at the top rather than however deep the last one
        // had been scrolled.
        .onChange(of: searchText) { _, _ in
            visibleCount = Self.pageSize
        }
    }

    private var matches: [WalletTransaction] {
        let all = store.transactions(forOrganizationId: organizationId)
            .sorted { $0.updatedAt > $1.updatedAt }

        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else {
            return all
        }

        return all.filter { transaction in
            [
                transaction.title,
                transaction.detail,
                transaction.status.title,
                transaction.appName ?? "",
                transaction.action ?? "",
                transaction.resourceId ?? ""
            ]
            .contains { $0.lowercased().contains(query) }
        }
    }

    private var page: [WalletTransaction] {
        Array(matches.prefix(visibleCount))
    }
}

private struct OrganizationLedgerRow: View {
    var transaction: WalletTransaction

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(transaction.title)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Text(transaction.status.title)
                    .font(.caption2.weight(.bold))
                    .padding(.vertical, 3)
                    .padding(.horizontal, 7)
                    .background(tint.opacity(0.14), in: Capsule())
                    .foregroundStyle(tint)
            }

            if !transaction.detail.isEmpty {
                Text(transaction.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Text(transaction.updatedAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3)
    }

    /// Pending is the only state that wants the holder to do something, so it
    /// is the only one that carries an attention colour.
    private var tint: Color {
        switch transaction.status {
        case .pendingAcceptance: return VanguardTheme.blue
        case .declined: return .red
        default: return VanguardTheme.green
        }
    }
}

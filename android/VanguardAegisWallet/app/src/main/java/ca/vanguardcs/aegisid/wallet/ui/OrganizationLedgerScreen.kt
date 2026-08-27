package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ca.vanguardcs.aegisid.wallet.data.WalletStore
import ca.vanguardcs.aegisid.wallet.model.WalletTransaction
import ca.vanguardcs.aegisid.wallet.model.WalletTransactionStatus
import java.text.DateFormat
import java.util.Date

/**
 * One organization's wallet ledger.
 *
 * The Ledger tab shows everything the holder has ever answered, across every
 * organization. Inside an organization that is the wrong question: what matters
 * there is what *this* organization has asked for. Same records, filtered to the
 * connections that belong to it.
 *
 * Pages rather than rendering the lot, because the ledger is the one place in
 * the wallet where history genuinely accumulates. Mirrors
 * OrganizationLedgerView on iOS.
 */
@Composable
fun OrganizationLedgerScreen(
    store: WalletStore,
    organizationId: String,
    organizationName: String,
    onBack: () -> Unit
) {
    val pageSize = 20
    var searchText by rememberSaveable { mutableStateOf("") }
    var visibleCount by remember { mutableIntStateOf(pageSize) }

    val matches = remember(store.transactions, store.connections, searchText, organizationId) {
        val all = store.transactionsForOrganization(organizationId)
            .sortedByDescending { it.updatedAt }
        val query = searchText.trim().lowercase()
        if (query.isEmpty()) {
            all
        } else {
            all.filter { transaction ->
                listOf(
                    transaction.title,
                    transaction.detail,
                    transaction.status.name,
                    transaction.appName.orEmpty(),
                    transaction.action.orEmpty(),
                    transaction.resourceId.orEmpty()
                ).any { it.lowercase().contains(query) }
            }
        }
    }

    val page = matches.take(visibleCount)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(VanguardColors.Mist),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack) { Text("< $organizationName") }
            }
            Text("Ledger", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }

        item {
            OutlinedTextField(
                value = searchText,
                onValueChange = {
                    searchText = it
                    // A new search starts at the top rather than however deep
                    // the last one had been scrolled.
                    visibleCount = pageSize
                },
                singleLine = true,
                placeholder = { Text("Search this organization's ledger") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (matches.isEmpty()) {
            item {
                EmptyState(
                    if (searchText.isBlank()) "Nothing here yet" else "No matches",
                    if (searchText.isBlank())
                        "Approvals and credentials from $organizationName will appear here."
                    else
                        "No ledger entries match “$searchText”."
                )
            }
        } else {
            item {
                Text(
                    "${matches.size} ${if (matches.size == 1) "entry" else "entries"}",
                    color = Color.Gray,
                    style = MaterialTheme.typography.labelLarge
                )
            }

            items(page, key = { it.id }) { transaction ->
                OrganizationLedgerRow(transaction)
            }

            if (page.size < matches.size) {
                item {
                    // Appearing is what asks for the next page, so scrolling is
                    // the only gesture involved.
                    TextButton(onClick = { visibleCount += pageSize }) {
                        Text("Show more")
                    }
                }
            }
        }
    }
}

@Composable
private fun OrganizationLedgerRow(transaction: WalletTransaction) {
    // Pending is the only state that wants the holder to do something, so it is
    // the only one that carries an attention colour.
    val tint = when (transaction.status) {
        WalletTransactionStatus.PendingAcceptance -> VanguardColors.Blue
        WalletTransactionStatus.Declined -> MaterialTheme.colorScheme.error
        else -> VanguardColors.Green
    }

    AegisCard {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Text(
                transaction.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            Text(
                transaction.status.name,
                color = tint,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .background(tint.copy(alpha = 0.12f), RoundedCornerShape(100.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp)
            )
        }
        if (transaction.detail.isNotBlank()) {
            Text(transaction.detail, color = Color.Gray, style = MaterialTheme.typography.bodySmall)
        }
        Text(
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                .format(Date(transaction.updatedAt)),
            color = Color.Gray,
            style = MaterialTheme.typography.labelSmall
        )
    }
}

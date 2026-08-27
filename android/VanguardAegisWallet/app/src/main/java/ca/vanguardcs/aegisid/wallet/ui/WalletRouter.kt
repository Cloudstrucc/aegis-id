package ca.vanguardcs.aegisid.wallet.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Where the wallet is, and where a screen wants to send it.
 *
 * The tab bar used to be the only thing that could change tabs, which meant a
 * button on Home could describe an action on Scan but not perform it. Mirrors
 * AppRouter on iOS so the two wallets navigate the same way.
 *
 * Kept out of WalletStore because none of it is wallet state: not persisted,
 * not survived across launches, and no credential depends on it.
 */
class WalletRouter {
    var selectedTab by mutableStateOf(WalletTab.Home)

    /**
     * The organization the Organizations tab should open, set when somebody
     * arrives from elsewhere — picking a connection in Settings, say. Consumed
     * rather than observed, so going back shows the list again instead of
     * bouncing straight into the same organization.
     */
    var focusedOrganizationId by mutableStateOf<String?>(null)
        private set


    /**
     * A short-lived confirmation, shown over whichever tab is on screen.
     *
     * Separate from the wallet challenge banner: that one waits for an answer
     * and must not disappear on its own. This one reports something that has
     * already happened and gets out of the way.
     */
    var flash by mutableStateOf<FlashNotice?>(null)
        private set

    fun show(tab: WalletTab) {
        selectedTab = tab
    }

    fun openOrganization(organizationId: String) {
        focusedOrganizationId = organizationId
        selectedTab = WalletTab.Organizations
    }

    fun consumeFocusedOrganization(): String? {
        val id = focusedOrganizationId
        focusedOrganizationId = null
        return id
    }

    /**
     * Android lists connections on their own tab, so this is a plain tab
     * change. iOS keeps them inside Settings and has to push a screen.
     */
    fun openConnections() {
        selectedTab = WalletTab.Connections
    }

    fun flash(notice: FlashNotice) {
        flash = notice
    }

    fun dismissFlash() {
        flash = null
    }
}

data class FlashNotice(
    val message: String,
    val succeeded: Boolean = true
)

/**
 * The transient confirmation itself.
 *
 * Tappable to dismiss early, but it does not require a tap — a holder who has
 * already moved on should not be left with a banner to clear. The caller times
 * it out.
 */
@Composable
fun FlashNoticeBanner(notice: FlashNotice, onDismiss: () -> Unit) {
    val tint = if (notice.succeeded) VanguardColors.Green else MaterialTheme.colorScheme.error

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .background(Color.White, RoundedCornerShape(8.dp))
            .clickable(onClick = onDismiss)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            if (notice.succeeded) Icons.Outlined.CheckCircle else Icons.Outlined.WarningAmber,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(20.dp)
        )
        Text(
            notice.message,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = VanguardColors.Ink
        )
    }
}

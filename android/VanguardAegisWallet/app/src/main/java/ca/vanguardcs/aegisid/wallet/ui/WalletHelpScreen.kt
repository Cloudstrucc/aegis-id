package ca.vanguardcs.aegisid.wallet.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ca.vanguardcs.aegisid.wallet.BuildConfig

/**
 * What to do with a wallet you have just installed.
 *
 * The Play listing is the one route into this app that does not start with an
 * invitation: somebody hears about Aegis ID, installs the wallet, opens it, and
 * has nothing to redeem and no idea where the other half of the product lives.
 * Everything here answers that — where the web app is, how a Wallet ID gets you
 * a credential, and the two places an invitation can be redeemed.
 *
 * Reachable from first-run setup, the top bar, and Settings, because the
 * question outlasts onboarding: holders join their second organization months
 * after their first.
 *
 * @param tabsAvailable setup has no bottom bar yet, so the two routes below are
 *   described rather than pointed at while it is on screen.
 */
@Composable
fun WalletHelpScreen(tabsAvailable: Boolean = true) {
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(VanguardColors.Mist),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item { WebAppPanel(context) }

        item {
            HelpCard(number = "1", title = "Set up this wallet") {
                Text(
                    "Give an email address, and the wallet mints a Wallet ID and ten single-use " +
                        "recovery codes. The codes are shown once — save them before you continue.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "The Wallet ID is what you hand an administrator so they can issue a credential " +
                        "to this device. It is an identifier, not a secret: knowing it does not let " +
                        "anybody act as you.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "It is on the Settings tab whenever you need it again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray
                )
            }
        }

        item {
            HelpCard(number = "2", title = "Redeem an invitation") {
                Text(
                    "A wallet with no invitation holds nothing. An organization sends you one, and " +
                        "there are two ways to take it in.",
                    style = MaterialTheme.typography.bodyMedium
                )

                HelpRoute(
                    icon = Icons.Outlined.QrCodeScanner,
                    title = if (tabsAvailable) "Scan tab" else "Scan a QR code",
                    detail = "Point the camera at an invitation QR shown on a computer screen or " +
                        "printed on a letter."
                )

                HelpRoute(
                    icon = Icons.Outlined.Link,
                    title = if (tabsAvailable) "Home tab · Paste invitation" else "Paste the link",
                    detail = "For an invitation that arrived by email or message on this phone. Copy " +
                        "the aegisid:// link and paste it in. This is the one to use when the " +
                        "invitation is on the same screen you are holding — you cannot scan a code " +
                        "with the device displaying it."
                )

                Text(
                    "Tapping an invitation link on this phone opens the wallet and redeems it " +
                        "directly, so most holders never do either by hand.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray
                )
            }
        }

        // The question that arrives at the second organization, not the first,
        // and the one holders most often solve by installing a second wallet.
        item {
            HelpCard(icon = Icons.Outlined.Business, title = "One wallet, many organizations") {
                Text(
                    "You do not need a second wallet for a second organization. Every invitation you " +
                        "redeem adds its organization to this one, and the Orgs tab lists them all.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "They stay separate. Each organization sees only the credentials it issued you " +
                        "and the approvals it asked for — never another organization's, and never " +
                        "the list of who else you hold a credential from.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "The same Wallet ID works for all of them, so it is safe to give out again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray
                )
            }
        }

        item {
            HelpCard(icon = Icons.Outlined.Email, title = "No invitation yet?") {
                Text(
                    "Ask an administrator at your organization to send one to the email address you " +
                        "registered here, or give them your Wallet ID and they can issue straight to " +
                        "this device.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "If your organization does not use Aegis ID yet, the web app above is where a " +
                        "workspace is created.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray
                )
            }
        }
    }
}

/**
 * First, and deliberately the largest thing on the screen. A holder who
 * installed the wallet before registering anywhere needs the address of the
 * service more than they need any instruction on this page.
 */
@Composable
private fun WebAppPanel(context: Context) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(listOf(VanguardColors.Navy, VanguardColors.Blue)),
                RoundedCornerShape(8.dp)
            )
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(
            "AEGIS ID SERVICE",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = Color.White.copy(alpha = 0.7f)
        )
        Text(
            BuildConfig.AEGIS_WEB_APP_BASE_URL,
            style = MaterialTheme.typography.titleMedium,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
        Text(
            "This wallet is the holder's half of Aegis ID. Organizations sign in on the web to " +
                "issue credentials and raise approvals; you answer them here.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.84f)
        )

        Button(
            onClick = { openWebApp(context) },
            colors = ButtonDefaults.buttonColors(
                containerColor = Color.White,
                contentColor = VanguardColors.Navy
            ),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Outlined.OpenInBrowser, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("  Open the web app", fontWeight = FontWeight.Bold)
        }

        TextButton(onClick = { copyWebAppAddress(context) }) {
            Icon(
                Icons.Outlined.ContentCopy,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.size(16.dp)
            )
            Text(
                "  Copy the address",
                color = Color.White.copy(alpha = 0.85f),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

/**
 * The web app in a browser view over the wallet rather than a hand-off to
 * Chrome.
 *
 * Leaving the app to answer "where do I start" is the point at which holders
 * stop coming back. A Custom Tab falls back to the default browser on its own
 * when nothing on the device supports one; the catch below covers a device with
 * no browser at all, where a crash would be a poor answer to a help screen.
 */
fun openWebApp(context: Context) {
    val uri = Uri.parse(BuildConfig.AEGIS_WEB_APP_BASE_URL)
    try {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, uri)
    } catch (error: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (fallbackError: ActivityNotFoundException) {
            copyWebAppAddress(context)
        }
    }
}

fun copyWebAppAddress(context: Context) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    clipboard?.setPrimaryClip(
        ClipData.newPlainText("Aegis ID", BuildConfig.AEGIS_WEB_APP_BASE_URL)
    )
}

@Composable
private fun HelpCard(
    number: String? = null,
    icon: ImageVector? = null,
    title: String,
    content: @Composable () -> Unit
) {
    AegisCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Box(
                modifier = Modifier
                    .size(26.dp)
                    .background(
                        if (number != null) VanguardColors.Blue else VanguardColors.Green,
                        CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (number != null) {
                    Text(
                        number,
                        color = Color.White,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold
                    )
                } else if (icon != null) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(15.dp)
                    )
                }
            }
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
        content()
    }
}

@Composable
private fun HelpRoute(icon: ImageVector, title: String, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(VanguardColors.Mist, RoundedCornerShape(8.dp))
            .padding(11.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp)
    ) {
        Icon(icon, contentDescription = null, tint = VanguardColors.Blue, modifier = Modifier.size(22.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        }
    }
}

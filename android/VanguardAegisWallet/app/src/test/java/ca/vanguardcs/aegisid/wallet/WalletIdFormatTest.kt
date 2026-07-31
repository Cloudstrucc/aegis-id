package ca.vanguardcs.aegisid.wallet

import ca.vanguardcs.aegisid.wallet.data.WalletIdFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wallet ID format parity with the server and iOS.
 *
 * The vectors mirror tests/fixtures/wallet-id-vectors.json so a change to the
 * check-symbol rule on any platform fails here.
 */
class WalletIdFormatTest {

    private val validIds = listOf(
        "AEG-KVAM-P0KW-RTJ9-3V18"
    )

    @Test
    fun `accepts well formed wallet ids`() {
        validIds.forEach { assertTrue("$it should be valid", WalletIdFormat.isValid(it)) }
    }

    @Test
    fun `rejects a single character typo`() {
        assertFalse(WalletIdFormat.isValid("AEG-KVAN-P0KW-RTJ9-3V18"))
    }

    @Test
    fun `rejects an adjacent transposition`() {
        assertFalse(WalletIdFormat.isValid("AEG-KVAM-PK0W-RTJ9-3V18"))
    }

    @Test
    fun `rejects malformed input`() {
        assertFalse(WalletIdFormat.isValid(""))
        assertFalse(WalletIdFormat.isValid(null))
        assertFalse(WalletIdFormat.isValid("AEG-TOO-SHORT"))
        assertFalse(WalletIdFormat.isValid("AEG-KVAM-P0KW-RTJ9-3V1!"))
    }

    @Test
    fun `parsing is case and dash insensitive`() {
        val canonical = validIds.first()
        assertEquals(canonical, WalletIdFormat.parse(canonical.lowercase()))
        assertEquals(canonical, WalletIdFormat.parse(canonical.replace("-", "")))
        assertEquals(canonical, WalletIdFormat.parse("  ${canonical.lowercase()}  "))
    }

    @Test
    fun `matches ignores formatting differences`() {
        val canonical = validIds.first()
        assertTrue(WalletIdFormat.matches(canonical, canonical.lowercase().replace("-", "")))
        assertFalse(WalletIdFormat.matches(canonical, "AEG-KVAN-P0KW-RTJ9-3V18"))
        assertFalse(WalletIdFormat.matches(canonical, null))
    }
}

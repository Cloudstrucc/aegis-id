package ca.vanguardcs.aegisid.wallet.data

/**
 * Wallet ID parsing and validation, mirroring src/services/wallet-id.js and the
 * iOS WalletIdFormat exactly so all three platforms agree on what is valid.
 *
 * Format: AEG-XXXX-XXXX-XXXX-XXXX — 16 significant Crockford Base32 characters
 * (no I, L, O or U) where the final character is a mod-37 check symbol that
 * catches single-character typos and adjacent transpositions.
 */
object WalletIdFormat {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val PREFIX = "AEG"
    private const val TOTAL_LENGTH = 16
    private const val BODY_LENGTH = 15
    private const val CHECK_MODULUS = 37

    /** Strip formatting and map the characters people commonly substitute. */
    fun normalizeInput(value: String?): String {
        var significant = (value ?: "").uppercase()
            .replace(" ", "")
            .replace("-", "")
        if (significant.startsWith(PREFIX)) {
            significant = significant.removePrefix(PREFIX)
        }
        return significant
            .replace('I', '1')
            .replace('L', '1')
            .replace('O', '0')
            .replace('U', 'V')
    }

    fun checkSymbol(body: String): Char? {
        var sum = 0
        body.forEachIndexed { index, character ->
            val value = ALPHABET.indexOf(character)
            if (value == -1) return null
            sum += value * (index + 2)
        }
        val residue = sum % CHECK_MODULUS
        return if (residue < ALPHABET.length) ALPHABET[residue] else null
    }

    fun format(significant: String): String =
        "$PREFIX-" + significant.chunked(4).joinToString("-")

    /** Canonical form, or null when the value is not a structurally valid Wallet ID. */
    fun parse(value: String?): String? {
        val significant = normalizeInput(value)
        if (significant.length != TOTAL_LENGTH) return null
        if (!significant.all { ALPHABET.contains(it) }) return null

        val body = significant.substring(0, BODY_LENGTH)
        val expected = checkSymbol(body) ?: return null
        if (expected != significant[BODY_LENGTH]) return null

        return format(significant)
    }

    fun isValid(value: String?): Boolean = parse(value) != null

    /** True when two Wallet IDs refer to the same wallet, ignoring formatting. */
    fun matches(left: String?, right: String?): Boolean {
        val a = parse(left) ?: return false
        val b = parse(right) ?: return false
        return a == b
    }
}

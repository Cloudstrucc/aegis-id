import Foundation

enum AegisWalletEnvironment {
    static let webAppURL = configuredURL(
        infoKey: "AEGIS_WEB_APP_BASE_URL",
        fallback: "https://vanguard-aegis-id-0e75d1.azurewebsites.net"
    )
    static let holderAdminURL = URL(string: "http://localhost:6011")!
    static let issuerAdminURL = URL(string: "http://localhost:4011")!
    static let verifierAdminURL = URL(string: "http://localhost:5011")!
    static let mediatorAdminURL = URL(string: "http://localhost:3011")!

    /// The URL scheme this build registers.
    ///
    /// Each configuration registers its own (`aegisid-local`, `aegisid-dev`,
    /// `aegisid-qa`, `aegisid`) so all four can be installed side by side, and
    /// the server emits links in the scheme of the environment it is serving.
    /// Read from the bundle rather than hardcoded, because a literal `aegisid`
    /// silently drops every link outside the production build.
    static let urlScheme: String = registeredAegisScheme() ?? "aegisid"

    private static func registeredAegisScheme() -> String? {
        let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        for type in types {
            let schemes = type["CFBundleURLSchemes"] as? [String] ?? []
            if let scheme = schemes.first(where: { $0.lowercased().hasPrefix("aegisid") }) {
                return scheme.lowercased()
            }
        }
        return nil
    }

    /// Whether a scanned or opened URL belongs to Aegis.
    ///
    /// Deliberately wider than this build's own scheme: a holder may paste a
    /// link produced by another environment, and answering "that is not an
    /// Aegis link" would be both wrong and unhelpful. The server still decides
    /// whether the token is valid where it is presented.
    static func isAegisScheme(_ scheme: String?) -> Bool {
        guard let scheme = scheme?.lowercased() else {
            return false
        }
        return scheme == urlScheme || scheme.hasPrefix("aegisid")
    }

    static var webAppDisplayValue: String {
        webAppURL.host() ?? webAppURL.absoluteString
    }

    static var usesHostedWebApp: Bool {
        guard let host = webAppURL.host()?.lowercased() else {
            return false
        }

        return !["localhost", "127.0.0.1", "::1"].contains(host)
    }

    private static func configuredURL(infoKey: String, fallback: String) -> URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String,
           let url = URL(string: configured),
           url.scheme != nil,
           url.host() != nil {
            return url
        }

        return URL(string: fallback)!
    }
}

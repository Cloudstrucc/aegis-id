import Foundation

enum AegisWalletEnvironment {
    static let webAppURL = configuredURL(
        infoKey: "AEGIS_WEB_APP_BASE_URL",
        fallback: "https://vanguard-aegis-id-65067d.azurewebsites.net"
    )
    static let holderAdminURL = URL(string: "http://localhost:6011")!
    static let issuerAdminURL = URL(string: "http://localhost:4011")!
    static let verifierAdminURL = URL(string: "http://localhost:5011")!
    static let mediatorAdminURL = URL(string: "http://localhost:3011")!

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

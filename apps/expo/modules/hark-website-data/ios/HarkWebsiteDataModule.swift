import ExpoModulesCore
import WebKit

/**
 * Web apps run in WKWebView's default (persistent) data store, so their own
 * sessions would survive a Hark sign-out or account switch. These helpers
 * remove that data: everything on sign-out, one site's records on revoke.
 */
public class HarkWebsiteDataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HarkWebsiteData")

    AsyncFunction("clearAllAsync") { (promise: Promise) in
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
        modifiedSince: .distantPast
      ) {
        promise.resolve(nil)
      }
    }.runOnQueue(.main)

    // Records are grouped by registrable domain (e.g. `example.com`), so a
    // host matches its own record and the record of any parent domain.
    AsyncFunction("clearHostAsync") { (host: String, promise: Promise) in
      let store = WKWebsiteDataStore.default()
      let types = WKWebsiteDataStore.allWebsiteDataTypes()
      let target = host.lowercased()
      store.fetchDataRecords(ofTypes: types) { records in
        let matching = records.filter { record in
          let name = record.displayName.lowercased()
          return target == name || target.hasSuffix(".\(name)")
        }
        guard !matching.isEmpty else {
          promise.resolve(nil)
          return
        }
        store.removeData(ofTypes: types, for: matching) {
          promise.resolve(nil)
        }
      }
    }.runOnQueue(.main)
  }
}

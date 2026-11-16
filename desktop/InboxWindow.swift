import AppKit
import WebKit

func allowedChatDestination(_ url: URL) -> Bool {
    guard url.user == nil, url.password == nil else { return false }
    if ["https", "http"].contains(url.scheme?.lowercased() ?? "") { return true }
    guard url.scheme?.lowercased() == "codex", url.port == nil, url.fragment == nil else { return false }
    if url.host == "threads" {
        return url.query == nil && url.path.range(of: "^/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil
    }
    // User-clicked, unsent draft only. No settings, plugins, arbitrary commands or remote origins.
    guard url.host == "new", url.path.isEmpty, url.absoluteString.count <= 70000,
          let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          items.count == 2, Set(items.map { $0.name }) == Set(["prompt", "path"]),
          let prompt = items.first(where: { $0.name == "prompt" })?.value,
          let path = items.first(where: { $0.name == "path" })?.value else { return false }
    return !prompt.isEmpty && prompt.count <= 8000 && path.hasPrefix("/") && path.count <= 2000 && !path.contains("\0")

}

// Only the loopback application can be displayed in this window. Task references
// and documentation links open in the user's browser, with no native JS bridge.
final class InboxWindow: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let webView: WKWebView
    let origin: URL

    init(origin: URL) {
        self.origin = origin
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Work Inbox"
        window.minSize = NSSize(width: 760, height: 520)
        window.isReleasedWhenClosed = false
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if !window.setFrameUsingName("WorkInboxMainWindow") { window.center() }
        window.setFrameAutosaveName("WorkInboxMainWindow")
    }
    required init?(coder: NSCoder) { fatalError("Use init(origin:)") }

    func showInbox() {
        if webView.url == nil { webView.load(URLRequest(url: origin)) }
        NSApp.setActivationPolicy(.regular)
        showWindow(nil)
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeFirstResponder(webView)
    }
    @objc func reloadInbox() {
        if webView.url == nil { webView.load(URLRequest(url: origin)) }
        else { webView.reload() }
    }
    private func isLocal(_ url: URL) -> Bool {
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
            && url.user == nil && url.password == nil
    }
    private func externalLink(_ action: WKNavigationAction) {
        guard action.navigationType == .linkActivated, let url = action.request.url,
              allowedChatDestination(url) else { return }
        NSWorkspace.shared.open(url)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if isLocal(url) {
            if action.targetFrame == nil {
                webView.load(action.request)
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        } else {
            externalLink(action)
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, isLocal(url) { webView.load(action.request) }
        else { externalLink(action) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let url = frame.request.url, isLocal(url), let window = window else { completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let url = frame.request.url, isLocal(url), let window = window else { completionHandler(); return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, let window = window else { return }
        let alert = NSAlert()
        alert.messageText = "Work Inbox couldn’t load"
        alert.informativeText = "Choose Reload to try again, or restart Work Inbox from the menu bar."
        alert.addButton(withTitle: "Reload")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] response in
            if response == .alertFirstButtonReturn { self?.reloadInbox() }
        }
    }
}

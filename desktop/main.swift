import AppKit
import Foundation
import ServiceManagement
import Darwin

// The desktop layer owns only installation/lifecycle. Work and authorization
// remain in the same Node server used by headless self-hosted installations.
let files = FileManager.default
let environment = ProcessInfo.processInfo.environment
let arguments = CommandLine.arguments
let headless = arguments.contains("--headless")
let background = arguments.contains("--background")
let support = environment["WORK_INBOX_DESKTOP_HOME"].map { URL(fileURLWithPath: $0) }
    ?? files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Work Inbox", isDirectory: true)
let port = Int(environment["WORK_INBOX_DESKTOP_PORT"] ?? "4310") ?? 4310
let inboxURL = URL(string: "http://127.0.0.1:\(port)")!
let resources = Bundle.main.resourceURL!
// Keep the legacy support root and bundle identity so upgrades retain data and connections.
let brandIdentity = try RheoIdentity(url: resources.appendingPathComponent("RheoBrand.json"))
let statusFile = support.appendingPathComponent("desktop-status.json")
let showNotification = Notification.Name("com.workinbox.desktop.show")

func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
func status() -> [String: Any] {
    guard let data = try? Data(contentsOf: statusFile),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
}
func privateFolder(_ url: URL) throws {
    try files.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
}
func errorAlert(_ message: String) {
    if headless { fputs("\(message)\n", stderr); return }
    let alert = NSAlert()
    alert.messageText = "Rheo couldn’t start"
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    alert.runModal()
}

final class Service {
    var process: Process?
    var input: Pipe?
    var log: FileHandle?
    var whenStopped: (() -> Void)?
    var stopping = false

    func start(importing: String? = nil) throws {
        stopping = false
        let logs = support.appendingPathComponent("logs", isDirectory: true)
        try privateFolder(logs)
        let path = logs.appendingPathComponent("service.log")
        if let size = try? files.attributesOfItem(atPath: path.path)[.size] as? NSNumber, size.intValue > 2_000_000 {
            let old = logs.appendingPathComponent("service.previous.log")
            try? files.removeItem(at: old)
            try files.moveItem(at: path, to: old)
        }
        if !files.fileExists(atPath: path.path) { files.createFile(atPath: path.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        log = try FileHandle(forWritingTo: path)
        try log?.seekToEnd()
        let child = Process()
        child.executableURL = resources.appendingPathComponent("runtime/node")
        child.arguments = [resources.appendingPathComponent("app/dist/desktop/host.js").path]
        child.currentDirectoryURL = resources.appendingPathComponent("app")
        // Finder launches must not depend on shell profiles or development tools.
        var env = environment.filter { !$0.key.hasPrefix("DYLD_") && !["NODE_OPTIONS", "NODE_PATH", "WORK_INBOX_IMPORT_DATA"].contains($0.key) }
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        env["NODE_ENV"] = "production"
        env["WORK_INBOX_DESKTOP_HOME"] = support.path
        env["WORK_INBOX_DESKTOP_PORT"] = String(port)
        env["WORK_INBOX_RESOURCES"] = resources.path
        if let importing = importing { env["WORK_INBOX_IMPORT_DATA"] = importing }
        child.environment = env
        input = Pipe()
        child.standardInput = input
        child.standardOutput = log
        child.standardError = log
        child.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                try? self?.input?.fileHandleForWriting.close()
                try? self?.log?.close()
                self?.whenStopped?()
            }
        }
        process = child
        try child.run()
    }
    func stop() {
        guard !stopping else { return }
        stopping = true
        guard let child = process, child.isRunning else { whenStopped?(); return }
        child.terminate()
        try? input?.fileHandleForWriting.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let service = Service()
    var item: NSStatusItem!
    let stateItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let openItem = NSMenuItem(title: "Open Rheo", action: #selector(openInbox), keyEquivalent: "o")
    let loginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLogin), keyEquivalent: "")
    let retryItem = NSMenuItem(title: "Restart Rheo", action: #selector(restart), keyEquivalent: "")
    var timer: Timer?
    var ready = false
    var quitting = false
    var pendingImport: String?
    var shouldOpen = !background
    var startupDeadline = Date()
    var startupErrorShown = false
    var signalSources: [DispatchSourceSignal] = []
    var inboxWindow: InboxWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        installMainMenu()
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(showExistingInstance), name: showNotification, object: support.path)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = brandIdentity.menuImage()
        item.button?.toolTip = "Rheo"
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        stateItem.isEnabled = false
        openItem.target = self
        loginItem.target = self
        retryItem.target = self
        menu.addItem(stateItem)
        menu.addItem(.separator())
        menu.addItem(openItem)
        menu.addItem(loginItem)
        menu.addItem(.separator())
        let importing = NSMenuItem(title: "Import Existing Data…", action: #selector(importExisting), keyEquivalent: "")
        importing.target = self
        menu.addItem(importing)
        menu.addItem(retryItem)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Rheo", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        service.whenStopped = { [weak self] in self?.didStop() }
        // Login launches are marked by Launch Services; explicit opens still show UI.
        if let event = NSAppleEventManager.shared().currentAppleEvent,
           event.paramDescriptor(forKeyword: 0x70727064)?.enumCodeValue == 0x6c676974 { shouldOpen = false }
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            // AppKit's deferred termination runs a nested event loop. Enter it
            // outside a serial main-queue callback so child-exit callbacks can run.
            source.setEventHandler { [weak self] in
                RunLoop.main.perform { [weak self] in self?.quitApp() }
            }
            source.resume()
            signalSources.append(source)
        }
        launch(importing: argument("--import-data"))
    }
    func launch(importing: String? = nil) {
        ready = false
        startupErrorShown = false
        stateItem.title = "Starting…"
        openItem.isEnabled = false
        startupDeadline = Date().addingTimeInterval(45)
        do { try service.start(importing: importing) }
        catch { stateItem.title = "Stopped"; errorAlert("The bundled service could not be launched. Reinstall Rheo and try again."); return }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in self?.checkStartup() }
    }
    func checkStartup() {
        guard !ready, let child = service.process else { return }
        let record = status()
        if (record["pid"] as? Int) == Int(child.processIdentifier) {
            if record["state"] as? String == "ready" {
                ready = true
                timer?.invalidate()
                stateItem.title = "Running locally"
                openItem.isEnabled = true
                inboxWindow?.reloadInbox()
                if shouldOpen { openInbox() }
                shouldOpen = false
            } else if record["state"] as? String == "error", !startupErrorShown {
                startupErrorShown = true
                timer?.invalidate()
                errorAlert(record["message"] as? String ?? "Rheo could not start.")
            }
        }
        if Date() > startupDeadline, child.isRunning {
            timer?.invalidate()
            startupErrorShown = true
            service.stop()
            errorAlert("Startup took too long. Restart Rheo to try again.")
        }
    }
    func didStop() {
        checkStartup()
        timer?.invalidate()
        ready = false
        openItem.isEnabled = false
        stateItem.title = "Stopped"
        if quitting { NSApp.reply(toApplicationShouldTerminate: true); return }
        if let source = pendingImport { pendingImport = nil; shouldOpen = true; launch(importing: source); return }
        if !service.stopping && !startupErrorShown {
            errorAlert("The local service stopped. Choose Restart Rheo to try again.")
        }
    }
    @objc func openInbox() {
        guard ready else { shouldOpen = true; return }
        if inboxWindow == nil { inboxWindow = InboxWindow(origin: inboxURL) }
        inboxWindow?.showInbox()
    }
    @objc func showExistingInstance() { openInbox() }
    @objc func reloadInbox() { inboxWindow?.reloadInbox() }
    func installMainMenu() {
        let main = NSMenu()
        let application = NSMenu(title: "Rheo")
        let show = application.addItem(withTitle: "Open Rheo", action: #selector(openInbox), keyEquivalent: "o")
        show.target = self
        application.addItem(.separator())
        application.addItem(withTitle: "Hide Rheo", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = application.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        application.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        application.addItem(.separator())
        let quit = application.addItem(withTitle: "Quit Rheo", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        let appItem = NSMenuItem()
        appItem.submenu = application
        main.addItem(appItem)
        let file = NSMenu(title: "File")
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let fileItem = NSMenuItem()
        fileItem.submenu = file
        main.addItem(fileItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem()
        editItem.submenu = edit
        main.addItem(editItem)
        let windows = NSMenu(title: "Window")
        windows.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windows.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        let reload = windows.addItem(withTitle: "Reload", action: #selector(reloadInbox), keyEquivalent: "r")
        reload.target = self
        let windowItem = NSMenuItem()
        windowItem.submenu = windows
        main.addItem(windowItem)
        NSApp.mainMenu = main
        NSApp.windowsMenu = windows
    }
    @objc func quitApp() { NSApp.terminate(nil) }
    @objc func restart() {
        guard !quitting else { return }
        shouldOpen = true
        if service.process?.isRunning == true {
            service.whenStopped = { [weak self] in
                self?.service.whenStopped = { [weak self] in self?.didStop() }
                self?.launch()
            }
            service.stop()
        } else { launch() }
    }
    @objc func importExisting() {
        let picker = NSOpenPanel()
        picker.title = "Choose the previous Rheo or Work Inbox data folder"
        picker.message = "Choose the folder containing work.sqlite. Quit the previous server first. Import requires an empty installation and leaves the original files intact."
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.showsHiddenFiles = true
        picker.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard picker.runModal() == .OK, let source = picker.url else { return }
        let confirmation = NSAlert()
        confirmation.messageText = "Import existing work and connections?"
        confirmation.informativeText = "The original data stays in place. Existing MCP settings are preserved; use Connections to get the new stable launcher configuration."
        confirmation.addButton(withTitle: "Import")
        confirmation.addButton(withTitle: "Cancel")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        if service.process?.isRunning == true { pendingImport = source.path; service.stop() }
        else { shouldOpen = true; launch(importing: source.path) }
    }
    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled || SMAppService.mainApp.status == .requiresApproval { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
            if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Launch at Login couldn’t be changed"
            alert.informativeText = "Move Rheo to Applications, then try again. You can also manage it in System Settings → General → Login Items."
            alert.runModal()
        }
    }
    func menuWillOpen(_ menu: NSMenu) {
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        retryItem.isEnabled = !quitting
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if ready { openInbox() } else { shouldOpen = true }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if service.process?.isRunning != true { return .terminateNow }
        quitting = true
        timer?.invalidate()
        service.stop()
        return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

// A per-user advisory lock also covers direct execution and copies of the app.
// It is released by the kernel even if the native launcher crashes.
do { try privateFolder(support) } catch { errorAlert("The application data folder could not be opened."); exit(1) }
let lockFD = open(support.appendingPathComponent("app.lock").path, O_CREAT | O_RDWR | O_CLOEXEC, mode_t(0o600))
guard lockFD >= 0 else { errorAlert("The application data folder could not be locked."); exit(1) }
if flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
    if !headless && !background {
        DistributedNotificationCenter.default().postNotificationName(showNotification, object: support.path, userInfo: nil, deliverImmediately: true)
    }
    exit(0)
}
if headless {
    let service = Service()
    var sources: [DispatchSourceSignal] = []
    service.whenStopped = { exit(service.stopping ? 0 : 1) }
    do { try service.start(importing: argument("--import-data")) }
    catch { fputs("Bundled service could not start.\n", stderr); exit(1) }
    for number in [SIGTERM, SIGINT] {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { service.stop() }
        source.resume()
        sources.append(source)
    }
    RunLoop.main.run()
} else {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}

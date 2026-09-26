import AppKit
import ApplicationServices

enum WindowEventKind: String, Encodable { case ready, available, created, unavailable, timeout, error }
enum WindowWatchMode: String { case available, created }

struct Event: Encodable {
    let event: WindowEventKind
    var message: String? = nil
}

@MainActor
final class WindowEvents {
    private let name: String
    private let mode: WindowWatchMode
    private var observer: AXObserver?
    private var application: AXUIElement?
    private var launchToken: NSObjectProtocol?
    private var timeout: Timer?
    private var finished = false

    init(name: String, mode: WindowWatchMode) { self.name = name; self.mode = mode }

    private func emit(_ event: Event) {
        do {
            var data = try JSONEncoder().encode(event)
            data.append(10)
            try FileHandle.standardOutput.write(contentsOf: data)
        } catch { exit(1) }
    }

    func start() {
        guard AXIsProcessTrusted() else {
            finish(.error, "System One needs Accessibility access to wait for native window events.")
            return
        }
        launchToken = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            MainActor.assumeIsolated { self?.attach(app) }
        }
        if let app = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == name }) {
            attach(app)
        }
        guard !finished else { return }
        emit(Event(event: .ready))
        if mode == .available, hasWindow() { finish(.available); return }
        timeout = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.finish(.timeout) }
        }
    }

    private func attach(_ app: NSRunningApplication) {
        guard app.localizedName == name, observer == nil, !finished else { return }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        application = appElement
        if mode == .available, hasWindow() { finish(.available); return }
        var value: AXObserver?
        let error = AXObserverCreate(app.processIdentifier, { _, _, notification, pointer in
            guard let pointer else { return }
            let watcher = Unmanaged<WindowEvents>.fromOpaque(pointer).takeUnretainedValue()
            MainActor.assumeIsolated { watcher.changed(notification as String) }
        }, &value)
        guard error == .success, let value else {
            finish(.unavailable, "Window event observation is unavailable (AX error \(error.rawValue)).")
            return
        }
        observer = value; application = appElement
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        let registered = AXObserverAddNotification(value, appElement, kAXWindowCreatedNotification as CFString, pointer)
        guard registered == .success else {
            // Some apps cannot answer AX requests until activated. Observation is
            // advisory: perform the tool, then read the resulting desktop once.
            finish(.unavailable, "Window event observation is unavailable (AX error \(registered.rawValue)).")
            return
        }
        if mode == .available {
            AXObserverAddNotification(value, appElement, kAXFocusedWindowChangedNotification as CFString, pointer)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(value), .commonModes)
        if mode == .available, hasWindow() { finish(.available) }
    }

    private func hasWindow() -> Bool {
        guard let application else { return false }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &value) == .success,
              let windows = value as? [AXUIElement] else { return false }
        return !windows.isEmpty
    }

    private func changed(_ notification: String) {
        if mode == .created, notification == kAXWindowCreatedNotification { finish(.created) }
        else if mode == .available, hasWindow() { finish(.available) }
    }

    private func finish(_ event: WindowEventKind, _ message: String? = nil) {
        guard !finished else { return }
        finished = true
        timeout?.invalidate()
        if let launchToken { NSWorkspace.shared.notificationCenter.removeObserver(launchToken) }
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        emit(Event(event: event, message: message))
        CFRunLoopStop(CFRunLoopGetMain())
    }

    var isFinished: Bool { finished }
}

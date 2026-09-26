import AppKit
import ApplicationServices
import Darwin

enum PermissionState: Equatable, Sendable {
    case granted
    case missing
    case unknown

    var title: String {
        switch self {
        case .granted: "Granted"
        case .missing: "Needs access"
        case .unknown: "Unable to check"
        }
    }
}

struct PermissionSnapshot: Sendable {
    let appAccessibility: Bool?
    let helperAccessibility: Bool?
    let driverAccessibility: Bool?
    let driverScreenRecording: Bool?

    var systemOneAccessibility: PermissionState {
        if appAccessibility == false || helperAccessibility == false { return .missing }
        if appAccessibility == true && helperAccessibility == true { return .granted }
        return .unknown
    }

    static func state(_ value: Bool?) -> PermissionState {
        switch value {
        case true: .granted
        case false: .missing
        case nil: .unknown
        }
    }
}

enum PermissionPane: String, CaseIterable {
    case accessibility = "Privacy_Accessibility"
    case screenRecording = "Privacy_ScreenCapture"
    case microphone = "Privacy_Microphone"

    var url: URL {
        URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(rawValue)")!
    }
}

private struct HelperPermission: Decodable {
    let accessibility: Bool
}

private struct DriverPermission: Decodable {
    struct Source: Decodable {
        let attribution: String
        let bundle_id: String
    }
    let accessibility: Bool
    let screen_recording: Bool
    let source: Source
}

enum PermissionProbe {
    static func read() -> PermissionSnapshot {
        let app = AXIsProcessTrusted()
        let helper = command(Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/NativeAccess"), ["permissions"])
            .flatMap { try? JSONDecoder().decode(HelperPermission.self, from: $0) }
        let bun = Bundle.main.object(forInfoDictionaryKey: "BunPath") as? String
        let script = Bundle.main.resourceURL?.appendingPathComponent("runtime/permission-status.js")
        let dataPath = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String
        let driverData: Data?
        if let bun, let script, let dataPath {
            driverData = command(URL(fileURLWithPath: bun), [script.path], directory: URL(fileURLWithPath: dataPath))
        } else { driverData = nil }
        let driver = driverStatus(driverData)
        return PermissionSnapshot(
            appAccessibility: app,
            helperAccessibility: helper?.accessibility,
            driverAccessibility: driver.accessibility,
            driverScreenRecording: driver.screenRecording
        )
    }

    static func driverStatus(_ data: Data?) -> (accessibility: Bool?, screenRecording: Bool?) {
        guard let data, let result = try? JSONDecoder().decode(DriverPermission.self, from: data),
              result.source.attribution == "driver-daemon", result.source.bundle_id == "com.trycua.driver" else {
            return (nil, nil)
        }
        return (result.accessibility, result.screen_recording)
    }

    private static func command(_ executable: URL, _ arguments: [String], directory: URL? = nil) -> Data? {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { return nil }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        if directory != nil {
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = Bundle.main.object(forInfoDictionaryKey: "ToolSearchPath") as? String
            process.environment = environment
        }
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let ended = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in ended.signal() }
        do {
            try process.run()
            if ended.wait(timeout: .now() + 3) == .timedOut {
                kill(process.processIdentifier, SIGKILL)
                return nil
            }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return process.terminationStatus == 0 ? data : nil
        } catch { return nil }
    }
}

@MainActor
final class PermissionSection: NSStackView {
    private let recheck = NSButton(title: "Recheck", target: nil, action: nil)
    private let appRow = PermissionRow(title: "System One · Accessibility", pane: .accessibility)
    private let appHint = NSTextField(wrappingLabelWithString: "If already enabled, remove System One and add it again.")
    private let driverAXRow = PermissionRow(title: "CUA Driver · Accessibility", pane: .accessibility)
    private let driverScreenRow = PermissionRow(title: "CUA Driver · Screen Recording", pane: .screenRecording)
    private let handyRow = PermissionRow(title: "Handy · Microphone", pane: .microphone)
    private var generation = 0
    var onLayoutChange: (() -> Void)?

    init() {
        super.init(frame: .zero)
        orientation = .vertical
        alignment = .leading
        spacing = 3
        let heading = NSTextField(labelWithString: "Permissions")
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        recheck.bezelStyle = .inline
        recheck.target = self
        recheck.action = #selector(recheckPressed)
        let header = NSStackView(views: [heading, NSView(), recheck])
        header.orientation = .horizontal
        header.alignment = .centerY
        addArrangedSubview(header)
        addArrangedSubview(appRow)
        appHint.font = .systemFont(ofSize: 11)
        appHint.textColor = .secondaryLabelColor
        addArrangedSubview(appHint)
        for row in [driverAXRow, driverScreenRow, handyRow] { addArrangedSubview(row) }
        for view in arrangedSubviews { view.widthAnchor.constraint(equalTo: widthAnchor).isActive = true }
        update(PermissionSnapshot(appAccessibility: nil, helperAccessibility: nil, driverAccessibility: nil, driverScreenRecording: nil))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    @objc private func recheckPressed() { refresh() }

    func refresh(using probe: @escaping @Sendable () -> PermissionSnapshot = PermissionProbe.read) {
        generation += 1
        let current = generation
        for row in [appRow, driverAXRow, driverScreenRow] { row.update(.unknown, title: "Checking…") }
        Task.detached(priority: .utility) { [weak self] in
            let snapshot = probe()
            await MainActor.run {
                guard let self, self.generation == current else { return }
                self.update(snapshot)
            }
        }
    }

    func update(_ snapshot: PermissionSnapshot) {
        appRow.update(snapshot.systemOneAccessibility)
        appHint.isHidden = snapshot.systemOneAccessibility != .missing
        driverAXRow.update(PermissionSnapshot.state(snapshot.driverAccessibility))
        driverScreenRow.update(PermissionSnapshot.state(snapshot.driverScreenRecording))
        handyRow.update(.unknown, title: "Check in macOS")
        onLayoutChange?()
    }
}

@MainActor
private final class PermissionRow: NSStackView {
    let status = NSTextField(labelWithString: "Unable to check")
    private let button = NSButton(title: "Open", target: nil, action: nil)
    private let pane: PermissionPane

    init(title: String, pane: PermissionPane) {
        self.pane = pane
        super.init(frame: .zero)
        orientation = .horizontal
        alignment = .centerY
        spacing = 5
        let name = NSTextField(labelWithString: title)
        name.font = .systemFont(ofSize: 11)
        name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        status.font = .systemFont(ofSize: 11)
        button.bezelStyle = .inline
        button.target = self
        button.action = #selector(openPane)
        button.setAccessibilityLabel("Open \(title) settings")
        addArrangedSubview(name)
        addArrangedSubview(NSView())
        addArrangedSubview(status)
        addArrangedSubview(button)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func update(_ state: PermissionState, title: String? = nil) {
        status.stringValue = title ?? state.title
        status.textColor = state == .granted ? .systemGreen : state == .missing ? .systemOrange : .secondaryLabelColor
        button.isHidden = state == .granted
    }

    @objc private func openPane() { NSWorkspace.shared.open(pane.url) }
}

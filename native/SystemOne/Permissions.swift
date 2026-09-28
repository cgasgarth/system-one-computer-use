import AppKit
import Darwin

struct CodexSetupSnapshot: Sendable {
    let runtimeInstalled: Bool?
    let computerUseEnabled: Bool?
    let chromeEnabled: Bool?

    static let unknown = CodexSetupSnapshot(
        runtimeInstalled: nil, computerUseEnabled: nil, chromeEnabled: nil
    )

    static func label(_ enabled: Bool?) -> String {
        switch enabled {
        case true: "Enabled in Codex"
        case false: "Needs setup"
        case nil: "Unable to check"
        }
    }
}

private struct CodexSetupReport: Decodable {
    let runtimeInstalled: Bool
    let computerUseEnabled: Bool?
    let chromeEnabled: Bool?
}

enum PermissionProbe {
    static func read() -> CodexSetupSnapshot {
        guard let bun = Bundle.main.object(forInfoDictionaryKey: "BunPath") as? String,
              let script = Bundle.main.resourceURL?.appendingPathComponent("runtime/permission-status.js"),
              let dataPath = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String,
              let data = command(URL(fileURLWithPath: bun), [script.path], directory: URL(fileURLWithPath: dataPath)),
              let result = try? JSONDecoder().decode(CodexSetupReport.self, from: data) else {
            return .unknown
        }
        return CodexSetupSnapshot(
            runtimeInstalled: result.runtimeInstalled,
            computerUseEnabled: result.computerUseEnabled,
            chromeEnabled: result.chromeEnabled
        )
    }

    private static func command(_ executable: URL, _ arguments: [String], directory: URL) -> Data? {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { return nil }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.standardError = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
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
    private let runtimeRow = SetupRow(
        owner: "ChatGPT / Codex", capability: "Desktop control runtime", buttonTitle: "Download",
        destination: URL(string: "https://chatgpt.com/download/")!
    )
    private let computerRow = SetupRow(
        owner: "Computer Use", capability: "Codex plugin", buttonTitle: "Open Codex",
        destination: URL(fileURLWithPath: "/Applications/ChatGPT.app")
    )
    private let chromeRow = SetupRow(
        owner: "Chrome", capability: "Codex plugin", buttonTitle: "Open Codex",
        destination: URL(fileURLWithPath: "/Applications/ChatGPT.app")
    )
    private let handyRow = SetupRow(
        owner: "Handy", capability: "Microphone", buttonTitle: "Open Settings",
        destination: URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")!
    )
    private let hint = NSTextField(wrappingLabelWithString:
        "In Codex Settings > Plugins, enable Computer Use and Chrome. The app checks the connection when used."
    )
    private var generation = 0
    var onLayoutChange: (() -> Void)?

    init() {
        super.init(frame: .zero)
        orientation = .vertical
        alignment = .leading
        spacing = 6
        let heading = NSTextField(labelWithString: "Control setup")
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        recheck.isBordered = false
        recheck.font = .systemFont(ofSize: 12)
        recheck.contentTintColor = .linkColor
        recheck.target = self
        recheck.action = #selector(recheckPressed)
        let header = NSStackView(views: [heading, NSView(), recheck])
        header.orientation = .horizontal
        header.alignment = .centerY
        addArrangedSubview(header)
        for row in [runtimeRow, computerRow, chromeRow, handyRow] { append(row) }
        hint.font = .systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor
        addArrangedSubview(hint)
        for view in arrangedSubviews { view.widthAnchor.constraint(equalTo: widthAnchor).isActive = true }
        update(.unknown)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private func append(_ row: SetupRow) {
        let separator = NSBox()
        separator.boxType = .separator
        addArrangedSubview(separator)
        addArrangedSubview(row)
    }

    @objc private func recheckPressed() { refresh() }

    func refresh(using probe: @escaping @Sendable () -> CodexSetupSnapshot = PermissionProbe.read) {
        generation += 1
        let current = generation
        for row in [runtimeRow, computerRow, chromeRow] {
            row.update(title: "Checking…", warning: false, showButton: false)
        }
        onLayoutChange?()
        Task.detached(priority: .utility) { [weak self] in
            let snapshot = probe()
            await MainActor.run {
                guard let self, self.generation == current else { return }
                self.update(snapshot)
            }
        }
    }

    func update(_ snapshot: CodexSetupSnapshot) {
        let installed = snapshot.runtimeInstalled
        runtimeRow.update(
            title: installed == true ? "Installed" : installed == false ? "Not installed" : "Unable to check",
            warning: installed == false,
            showButton: installed == false
        )
        computerRow.update(
            title: CodexSetupSnapshot.label(snapshot.computerUseEnabled),
            warning: snapshot.computerUseEnabled == false,
            showButton: installed == true && snapshot.computerUseEnabled != true
        )
        chromeRow.update(
            title: CodexSetupSnapshot.label(snapshot.chromeEnabled),
            warning: snapshot.chromeEnabled == false,
            showButton: installed == true && snapshot.chromeEnabled != true
        )
        handyRow.update(title: "Check in macOS", warning: false, showButton: true)
        onLayoutChange?()
    }
}

@MainActor
private final class SetupRow: NSStackView {
    let status = NSTextField(labelWithString: "Unable to check")
    private let button: NSButton
    private let destination: URL

    init(owner: String, capability: String, buttonTitle: String, destination: URL) {
        self.destination = destination
        button = NSButton(title: buttonTitle, target: nil, action: nil)
        super.init(frame: .zero)
        orientation = .horizontal
        alignment = .top
        spacing = 12
        let name = NSTextField(labelWithString: owner)
        name.font = .systemFont(ofSize: 13, weight: .medium)
        let detail = NSTextField(labelWithString: capability)
        detail.font = .systemFont(ofSize: 11)
        detail.textColor = .secondaryLabelColor
        let left = NSStackView(views: [name, detail])
        left.orientation = .vertical
        left.alignment = .leading
        left.spacing = 3
        status.font = .systemFont(ofSize: 11)
        status.alignment = .right
        button.isBordered = false
        button.font = .systemFont(ofSize: 11)
        button.contentTintColor = .linkColor
        button.target = self
        button.action = #selector(openDestination)
        button.setAccessibilityLabel("\(buttonTitle) for \(owner) \(capability)")
        let right = NSStackView(views: [status, button])
        right.orientation = .vertical
        right.alignment = .trailing
        right.spacing = 3
        addArrangedSubview(left)
        addArrangedSubview(NSView())
        addArrangedSubview(right)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func update(title: String, warning: Bool, showButton: Bool) {
        status.stringValue = title
        status.textColor = warning ? .systemOrange : .secondaryLabelColor
        button.isHidden = !showButton
    }

    @objc private func openDestination() { NSWorkspace.shared.open(destination) }
}

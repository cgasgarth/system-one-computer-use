import AppKit

struct ModelSettings: Codable {
    let decisionUrl: String
    let decisionModel: String
    let textUrl: String
    let textModel: String
}

@MainActor
final class SettingsMenu: NSViewController {
    let back = NSButton(title: "Back", target: nil, action: nil)
    let quit = NSButton(title: "Quit System One", target: nil, action: nil)
    let shortcut = NSButton(title: "Record shortcut", target: nil, action: nil)
    let mode = NSPopUpButton()
    let decisionUrl = NSTextField()
    let decisionModel = NSTextField()
    let textUrl = NSTextField()
    let textModel = NSTextField()
    let save = NSButton(title: "Save settings", target: nil, action: nil)
    let status = NSTextField(wrappingLabelWithString: "Connections use your configured model services.")

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 380, height: 506))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        back.frame = NSRect(x: 16, y: 463, width: 64, height: 26)
        back.bezelStyle = .inline
        back.image = NSImage(systemSymbolName: "chevron.left", accessibilityDescription: nil)
        back.imagePosition = .imageLeading
        view.addSubview(back)
        label("Settings", x: 91, y: 465, size: 18, weight: .semibold)
        label("Voice shortcut", x: 20, y: 421, size: 13, weight: .medium)
        shortcut.frame = NSRect(x: 179, y: 415, width: 181, height: 30)
        shortcut.bezelStyle = .rounded
        shortcut.setAccessibilityLabel("Record voice shortcut")
        view.addSubview(shortcut)
        label("Default computer", x: 20, y: 383, size: 13, weight: .medium)
        mode.frame = NSRect(x: 179, y: 376, width: 181, height: 29)
        mode.addItems(withTitles: ["Any", "Chrome", "macOS"])
        view.addSubview(mode)
        label("Decision model", x: 20, y: 339, size: 13, weight: .semibold)
        field(decisionUrl, placeholder: "System One endpoint URL", y: 303)
        field(decisionModel, placeholder: "Model ID", y: 267)
        label("Text model", x: 20, y: 228, size: 13, weight: .semibold)
        field(textUrl, placeholder: "Chat completions endpoint URL", y: 192)
        field(textModel, placeholder: "Model ID", y: 156)
        status.frame = NSRect(x: 20, y: 65, width: 340, height: 75)
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        view.addSubview(status)
        save.frame = NSRect(x: 220, y: 19, width: 144, height: 32)
        save.bezelStyle = .rounded
        save.bezelColor = .controlAccentColor
        view.addSubview(save)
        quit.frame = NSRect(x: 16, y: 21, width: 130, height: 28)
        quit.bezelStyle = .inline
        view.addSubview(quit)
    }

    private func label(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, weight: NSFont.Weight) {
        let item = NSTextField(labelWithString: text)
        item.font = .systemFont(ofSize: size, weight: weight)
        item.frame = NSRect(x: x, y: y, width: 250, height: 22)
        view.addSubview(item)
    }

    private func field(_ field: NSTextField, placeholder: String, y: CGFloat) {
        field.frame = NSRect(x: 20, y: y, width: 340, height: 28)
        field.placeholderString = placeholder
        field.setAccessibilityLabel(placeholder)
        field.font = .systemFont(ofSize: 12)
        field.isEditable = true
        field.bezelStyle = .roundedBezel
        view.addSubview(field)
    }

    func load() {
        mode.selectItem(at: UserDefaults.standard.integer(forKey: "targetMode"))
        do {
            let data = try exchange("read", input: nil)
            let settings = try JSONDecoder().decode(ModelSettings.self, from: data)
            decisionUrl.stringValue = settings.decisionUrl
            decisionModel.stringValue = settings.decisionModel
            textUrl.stringValue = settings.textUrl
            textModel.stringValue = settings.textModel
        } catch { status.stringValue = error.localizedDescription }
    }

    func persist() {
        do {
            let settings = ModelSettings(decisionUrl: decisionUrl.stringValue, decisionModel: decisionModel.stringValue,
                                         textUrl: textUrl.stringValue, textModel: textModel.stringValue)
            _ = try exchange("save", input: JSONEncoder().encode(settings))
            UserDefaults.standard.set(mode.indexOfSelectedItem, forKey: "targetMode")
            status.stringValue = "Saved. New tasks will use these settings."
        } catch { status.stringValue = error.localizedDescription }
    }

    private func exchange(_ operation: String, input: Data?) throws -> Data {
        guard let root = Bundle.main.object(forInfoDictionaryKey: "AppDataPath") as? String,
              let bun = Bundle.main.object(forInfoDictionaryKey: "BunPath") as? String,
              let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: bun)
        child.arguments = [resources.appendingPathComponent("runtime/settings.js").path, operation]
        child.currentDirectoryURL = URL(fileURLWithPath: root)
        let stdout = Pipe(), stdin = Pipe()
        child.standardOutput = stdout
        child.standardInput = stdin
        child.standardError = FileHandle.nullDevice
        try child.run()
        if let input { try stdin.fileHandleForWriting.write(contentsOf: input) }
        try stdin.fileHandleForWriting.close()
        let result = stdout.fileHandleForReading.readDataToEndOfFile()
        child.waitUntilExit()
        if child.terminationStatus != 0 {
            struct Failure: Decodable { let error: String }
            let failure = try JSONDecoder().decode(Failure.self, from: result)
            throw NSError(domain: "SystemOne.Settings", code: 1, userInfo: [NSLocalizedDescriptionKey: failure.error])
        }
        return result
    }
}

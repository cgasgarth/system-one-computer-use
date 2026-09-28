import AppKit

@MainActor
final class MenuSurface: NSView {
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() { layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
}

@MainActor
final class TranscriptView: NSTextView {
    var onPaste: (() -> Void)?
    var onChange: (() -> Void)?
    override func paste(_ sender: Any?) { super.paste(sender); onPaste?() }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command {
            switch event.charactersIgnoringModifiers {
            case "v": paste(nil); return true
            case "a": selectAll(nil); return true
            case "c": copy(nil); return true
            case "x": cut(nil); return true
            default: break
            }
        }
        return super.performKeyEquivalent(with: event)
    }
    override func didChangeText() { super.didChangeText(); needsDisplay = true; onChange?() }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if string.isEmpty {
            ("What would you like done?" as NSString).draw(at: NSPoint(x: 13, y: 12), withAttributes: [
                .font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.placeholderTextColor,
            ])
        }
    }
}

@MainActor
final class TaskMenu: NSViewController {
    static let size = NSSize(width: 360, height: 372)
    let editor = TranscriptView()
    let sessions = SessionMenu()
    var onActivity: (() -> Void)?
    let mode = NSPopUpButton()
    let status = NSTextField(wrappingLabelWithString: "Ready")
    let run = NSButton(title: "Start", target: nil, action: nil)
    let voice = NSButton(title: "Dictate", target: nil, action: nil)
    let cancel = NSButton(title: "Stop", target: nil, action: nil)
    let settings = NSButton(title: "", target: nil, action: nil)
    let latency = NSTextField(labelWithString: "—")
    let rate = NSTextField(labelWithString: "—")
    private var editorScroll: NSScrollView?
    private let approvalPanel = NSView()
    private let approvalDetails = NSTextView()
    private let approvalAllow = NSButton(title: "Allow once", target: nil, action: nil)
    private let approvalTask = NSButton(title: "Allow for task", target: nil, action: nil)
    private let approvalDecline = NSButton(title: "Decline", target: nil, action: nil)
    var onApprovalChoice: ((ApprovalResponse.Decision) -> Void)?
    private var locked = false

    override func loadView() {
        view = MenuSurface(frame: NSRect(origin: .zero, size: Self.size))
        view.wantsLayer = true
        view.autoresizesSubviews = false
        preferredContentSize = Self.size
        let heading = NSTextField(labelWithString: "System One")
        heading.font = .systemFont(ofSize: 16, weight: .semibold)
        heading.frame = NSRect(x: 18, y: 333, width: 200, height: 22)
        view.addSubview(heading)
        settings.frame = NSRect(x: 314, y: 330, width: 28, height: 28)
        settings.bezelStyle = .accessoryBarAction
        settings.isBordered = false
        settings.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: "Settings")
        settings.toolTip = "Settings"
        settings.setAccessibilityLabel("Settings")
        view.addSubview(settings)
        let target = NSTextField(labelWithString: "Control surface")
        target.font = .systemFont(ofSize: 10, weight: .medium)
        target.textColor = .secondaryLabelColor
        target.frame = NSRect(x: 20, y: 174, width: 120, height: 14)
        view.addSubview(target)
        mode.frame = NSRect(x: 14, y: 144, width: 100, height: 28)
        mode.isBordered = false
        mode.font = .systemFont(ofSize: 12, weight: .medium)
        sessions.picker.isBordered = false
        sessions.picker.font = .systemFont(ofSize: 12, weight: .medium)
        mode.addItems(withTitles: ["Auto", "Chrome", "Desktop"])
        mode.setAccessibilityLabel("Control surface")
        mode.toolTip = "Choose automatically, use Chrome, or use the macOS desktop."
        view.addSubview(mode)
        let sessionLabel = NSTextField(labelWithString: "Session")
        sessionLabel.font = .systemFont(ofSize: 10, weight: .medium); sessionLabel.textColor = .secondaryLabelColor
        sessionLabel.frame = NSRect(x: 190, y: 174, width: 90, height: 14)
        view.addSubview(sessionLabel)
        sessions.picker.frame = NSRect(x: 184, y: 144, width: 162, height: 28)
        view.addSubview(sessions.picker)
        addEditor()
        addApprovalPanel()
        voice.frame = NSRect(x: 18, y: 104, width: 82, height: 30)
        run.frame = NSRect(x: 260, y: 104, width: 82, height: 30)
        run.bezelColor = .controlAccentColor
        run.keyEquivalent = "\r"
        run.keyEquivalentModifierMask = .command
        run.toolTip = "Start task (⌘Return)"
        cancel.frame = run.frame
        for button in [voice, run, cancel] { button.bezelStyle = .rounded; button.font = .systemFont(ofSize: 13, weight: .medium); view.addSubview(button) }
        cancel.isHidden = true
        status.frame = NSRect(x: 20, y: 57, width: 320, height: 46)
        status.font = .systemFont(ofSize: 11)
        status.maximumNumberOfLines = 3
        status.lineBreakMode = .byTruncatingTail
        view.addSubview(status)
        let line = NSBox(frame: NSRect(x: 18, y: 49, width: 324, height: 1))
        line.boxType = .separator
        view.addSubview(line)
        metric(latency, title: "Median decision · ms", x: 18)
        metric(rate, title: "Actions / sec", x: 180)
        latency.toolTip = "Median System One request latency for this task, in milliseconds."
        rate.toolTip = "Tool actions that returned successfully per second, including observation and execution time. Failed attempts, unchanged results, waits, and internal decisions do not count."
        editor.onChange = { [weak self] in
            guard let self else { return }; self.updateRunButton()
            if !self.locked && !self.editor.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { self.onActivity?() }
        }
        setStatus("Ready", color: .secondaryLabelColor)
        updateRunButton()
    }

    private func addEditor() {
        let scroll = NSScrollView(frame: NSRect(x: 18, y: 197, width: 324, height: 116))
        editorScroll = scroll
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.wantsLayer = true
        scroll.layer?.cornerRadius = 10
        scroll.layer?.borderWidth = 0.5
        scroll.layer?.borderColor = NSColor.separatorColor.cgColor
        scroll.layer?.masksToBounds = true
        scroll.drawsBackground = true
        let fieldBackground = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(white: 0.145, alpha: 1) : NSColor(white: 0.97, alpha: 1)
        }
        scroll.backgroundColor = fieldBackground
        editor.frame = NSRect(x: 0, y: 0, width: 324, height: 116)
        editor.isRichText = false
        editor.isEditable = true
        editor.isSelectable = true
        editor.font = .systemFont(ofSize: 14)
        editor.textColor = .labelColor
        editor.backgroundColor = fieldBackground
        editor.textContainerInset = NSSize(width: 8, height: 10)
        editor.autoresizingMask = [.width]
        editor.isVerticallyResizable = true
        editor.textContainer?.widthTracksTextView = true
        editor.setAccessibilityLabel("Task")
        scroll.documentView = editor
        view.addSubview(scroll)
    }

    private func addApprovalPanel() {
        approvalPanel.frame = NSRect(x: 18, y: 197, width: 324, height: 116)
        approvalPanel.wantsLayer = true
        approvalPanel.layer?.cornerRadius = 10
        approvalPanel.layer?.borderWidth = 0.5
        approvalPanel.layer?.borderColor = NSColor.separatorColor.cgColor
        approvalPanel.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        let detailScroll = NSScrollView(frame: NSRect(x: 8, y: 36, width: 308, height: 72))
        detailScroll.hasVerticalScroller = true
        detailScroll.autohidesScrollers = true
        detailScroll.borderType = .noBorder
        approvalDetails.frame = detailScroll.bounds
        approvalDetails.isEditable = false
        approvalDetails.isSelectable = true
        approvalDetails.font = .systemFont(ofSize: 11)
        approvalDetails.drawsBackground = false
        approvalDetails.textContainerInset = NSSize(width: 3, height: 3)
        approvalDetails.setAccessibilityLabel("Control approval details")
        detailScroll.documentView = approvalDetails
        approvalPanel.addSubview(detailScroll)
        approvalDecline.frame = NSRect(x: 6, y: 5, width: 80, height: 26)
        approvalAllow.frame = NSRect(x: 91, y: 5, width: 101, height: 26)
        approvalTask.frame = NSRect(x: 197, y: 5, width: 120, height: 26)
        for button in [approvalDecline, approvalAllow, approvalTask] {
            button.bezelStyle = .rounded
            button.font = .systemFont(ofSize: 12, weight: .medium)
            button.target = self
            approvalPanel.addSubview(button)
        }
        approvalDecline.action = #selector(declineApproval)
        approvalAllow.action = #selector(allowApproval)
        approvalTask.action = #selector(allowForTask)
        approvalPanel.isHidden = true
        view.addSubview(approvalPanel)
    }

    func showApproval(_ prompt: ApprovalPrompt) {
        var details = ["Codex needs permission", prompt.message]
        if let site = prompt.site { details.append("Site: \(site)") }
        approvalDetails.string = details.joined(separator: "\n")
        approvalDetails.scrollToBeginningOfDocument(nil)
        editorScroll?.isHidden = true
        approvalPanel.isHidden = false
        approvalAllow.isEnabled = true
        approvalDecline.isEnabled = true
        approvalTask.isHidden = !prompt.canAllowTask
        approvalTask.isEnabled = prompt.canAllowTask
    }

    func clearApproval() {
        approvalPanel.isHidden = true
        editorScroll?.isHidden = false
        approvalDetails.string = ""
    }

    @objc private func allowApproval() { onApprovalChoice?(.allowOnce) }
    @objc private func allowForTask() { onApprovalChoice?(.allowTask) }
    @objc private func declineApproval() { onApprovalChoice?(.decline) }

    private func metric(_ value: NSTextField, title: String, x: CGFloat) {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 10)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        value.alignment = .center
        label.frame = NSRect(x: x, y: 29, width: 162, height: 14)
        value.font = .monospacedDigitSystemFont(ofSize: 16, weight: .medium)
        value.frame = NSRect(x: x, y: 7, width: 162, height: 21)
        view.addSubview(label)
        view.addSubview(value)
    }

    func setStatus(_ message: String, color: NSColor) {
        status.stringValue = message.replacingOccurrences(of: "\n", with: " ")
        status.textColor = color
        status.toolTip = message
    }

    func setLocked(_ value: Bool) {
        locked = value
        editor.isEditable = !value
        mode.isEnabled = !value
        sessions.picker.isEnabled = !value
        settings.isEnabled = !value
        updateRunButton()
    }

    func setActive(_ active: Bool) {
        run.isHidden = active
        cancel.isHidden = !active
        cancel.isEnabled = active
    }

    func updateRunButton() {
        run.isEnabled = !locked && !editor.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func focus() { view.window?.makeFirstResponder(editor) }
}

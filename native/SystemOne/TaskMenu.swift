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
            ("Describe a task…" as NSString).draw(at: NSPoint(x: 13, y: 12), withAttributes: [
                .font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.placeholderTextColor,
            ])
        }
    }
}

@MainActor
final class TaskMenu: NSViewController {
    static let size = NSSize(width: 360, height: 334)
    let editor = TranscriptView()
    let mode = NSPopUpButton()
    let status = NSTextField(wrappingLabelWithString: "Ready")
    let run = NSButton(title: "Run task", target: nil, action: nil)
    let voice = NSButton(title: "Dictate", target: nil, action: nil)
    let cancel = NSButton(title: "Stop", target: nil, action: nil)
    let settings = NSButton(title: "", target: nil, action: nil)
    let latency = NSTextField(labelWithString: "—")
    let rate = NSTextField(labelWithString: "—")
    let elapsed = NSTextField(labelWithString: "—")
    private let stateIcon = NSImageView()
    private var locked = false
    private var baseFrames: [(NSView, NSRect)] = []
    var onSizeChange: ((NSSize) -> Void)?

    override func loadView() {
        view = MenuSurface(frame: NSRect(origin: .zero, size: Self.size))
        view.wantsLayer = true
        view.autoresizesSubviews = false
        preferredContentSize = Self.size
        let heading = NSTextField(labelWithString: "System One")
        heading.font = .systemFont(ofSize: 15, weight: .semibold)
        heading.frame = NSRect(x: 18, y: 295, width: 200, height: 22)
        view.addSubview(heading)
        settings.frame = NSRect(x: 306, y: 292, width: 36, height: 28)
        settings.bezelStyle = .accessoryBarAction
        settings.isBordered = false
        settings.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: "Settings")
        settings.toolTip = "Settings"
        settings.setAccessibilityLabel("Settings")
        view.addSubview(settings)
        let target = NSTextField(labelWithString: "Use")
        target.font = .systemFont(ofSize: 12)
        target.textColor = .secondaryLabelColor
        target.frame = NSRect(x: 18, y: 258, width: 40, height: 18)
        view.addSubview(target)
        mode.frame = NSRect(x: 218, y: 252, width: 126, height: 28)
        mode.addItems(withTitles: ["Any", "Chrome", "macOS"])
        mode.setAccessibilityLabel("Computer")
        mode.toolTip = "Any lets the model choose the computer for your task."
        view.addSubview(mode)
        addEditor()
        voice.frame = NSRect(x: 14, y: 109, width: 103, height: 30)
        voice.image = NSImage(systemSymbolName: "mic", accessibilityDescription: nil)
        voice.imagePosition = .imageLeading
        run.frame = NSRect(x: 235, y: 109, width: 111, height: 30)
        run.bezelColor = .controlAccentColor
        run.keyEquivalent = "\r"
        run.keyEquivalentModifierMask = .command
        run.toolTip = "Run task (⌘Return)"
        cancel.frame = NSRect(x: 161, y: 109, width: 68, height: 30)
        for button in [voice, run, cancel] { button.bezelStyle = .rounded; view.addSubview(button) }
        cancel.isHidden = true
        stateIcon.frame = NSRect(x: 19, y: 75, width: 14, height: 14)
        view.addSubview(stateIcon)
        status.frame = NSRect(x: 40, y: 65, width: 301, height: 28)
        status.font = .systemFont(ofSize: 11)
        status.maximumNumberOfLines = 0
        status.lineBreakMode = .byWordWrapping
        view.addSubview(status)
        let line = NSBox(frame: NSRect(x: 18, y: 57, width: 324, height: 1))
        line.boxType = .separator
        view.addSubview(line)
        metric(latency, title: "Model / ms", x: 18)
        metric(rate, title: "Requests / s", x: 128)
        metric(elapsed, title: "Task / s", x: 238)
        latency.toolTip = "Mean System One HTTP request time in milliseconds."
        rate.toolTip = "Completed decisions per second, including planning and computer operations."
        elapsed.toolTip = "Total task time in seconds."
        editor.onChange = { [weak self] in self?.updateRunButton() }
        baseFrames = view.subviews.filter { $0.frame.minY >= 105 }.map { ($0, $0.frame) }
        setStatus("Ready", symbol: "circle", color: .secondaryLabelColor)
        updateRunButton()
    }

    private func addEditor() {
        let scroll = NSScrollView(frame: NSRect(x: 18, y: 150, width: 324, height: 91))
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .bezelBorder
        scroll.drawsBackground = true
        scroll.backgroundColor = .textBackgroundColor
        editor.frame = NSRect(x: 0, y: 0, width: 320, height: 89)
        editor.isRichText = false
        editor.isEditable = true
        editor.isSelectable = true
        editor.font = .systemFont(ofSize: 14)
        editor.textColor = .labelColor
        editor.backgroundColor = .textBackgroundColor
        editor.textContainerInset = NSSize(width: 8, height: 10)
        editor.autoresizingMask = [.width]
        editor.isVerticallyResizable = true
        editor.textContainer?.widthTracksTextView = true
        editor.setAccessibilityLabel("Task")
        scroll.documentView = editor
        view.addSubview(scroll)
    }

    private func metric(_ value: NSTextField, title: String, x: CGFloat) {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 10)
        label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: x, y: 33, width: 94, height: 14)
        value.font = .monospacedDigitSystemFont(ofSize: 14, weight: .medium)
        value.frame = NSRect(x: x, y: 13, width: 90, height: 18)
        view.addSubview(label)
        view.addSubview(value)
    }

    func setStatus(_ message: String, symbol: String, color: NSColor) {
        let measured = (message as NSString).boundingRect(
            with: NSSize(width: 301, height: 500), options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: NSFont.systemFont(ofSize: 11)])
        let height = max(28, ceil(measured.height) + 16)
        let delta = height - 28
        for (child, frame) in baseFrames { child.frame = frame.offsetBy(dx: 0, dy: delta) }
        stateIcon.frame.origin.y = 75 + delta
        status.frame.size.height = height
        let size = NSSize(width: Self.size.width, height: Self.size.height + height - 28)
        view.setFrameSize(size)
        preferredContentSize = size
        onSizeChange?(size)
        status.stringValue = message
        status.textColor = color
        status.toolTip = message
        stateIcon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        stateIcon.contentTintColor = color
    }

    func setLocked(_ value: Bool) {
        locked = value
        editor.isEditable = !value
        mode.isEnabled = !value
        settings.isEnabled = !value
        updateRunButton()
    }

    func updateRunButton() {
        run.isEnabled = !locked && !editor.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func focus() { view.window?.makeFirstResponder(editor) }
}

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
    let run = NSButton(title: "Start", target: nil, action: nil)
    let voice = NSButton(title: "Dictate", target: nil, action: nil)
    let cancel = NSButton(title: "Stop", target: nil, action: nil)
    let settings = NSButton(title: "", target: nil, action: nil)
    let latency = NSTextField(labelWithString: "—")
    let rate = NSTextField(labelWithString: "—")
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
        let target = NSTextField(labelWithString: "Control surface")
        target.font = .systemFont(ofSize: 12)
        target.textColor = .secondaryLabelColor
        target.frame = NSRect(x: 18, y: 258, width: 120, height: 18)
        view.addSubview(target)
        mode.frame = NSRect(x: 258, y: 252, width: 84, height: 28)
        mode.addItems(withTitles: ["Auto", "Chrome", "Desktop"])
        mode.setAccessibilityLabel("Control surface")
        mode.toolTip = "Choose automatically, use Chrome, or use the macOS desktop."
        view.addSubview(mode)
        addEditor()
        voice.frame = NSRect(x: 18, y: 109, width: 82, height: 30)
        run.frame = NSRect(x: 260, y: 109, width: 82, height: 30)
        run.bezelColor = .controlAccentColor
        run.keyEquivalent = "\r"
        run.keyEquivalentModifierMask = .command
        run.toolTip = "Start task (⌘Return)"
        cancel.frame = NSRect(x: 184, y: 109, width: 68, height: 30)
        for button in [voice, run, cancel] { button.bezelStyle = .rounded; button.font = .systemFont(ofSize: 13, weight: .medium); view.addSubview(button) }
        cancel.isHidden = true
        status.frame = NSRect(x: 18, y: 65, width: 324, height: 28)
        status.font = .systemFont(ofSize: 11)
        status.maximumNumberOfLines = 0
        status.lineBreakMode = .byWordWrapping
        view.addSubview(status)
        let line = NSBox(frame: NSRect(x: 18, y: 57, width: 324, height: 1))
        line.boxType = .separator
        view.addSubview(line)
        metric(latency, title: "Median latency · ms", x: 18)
        metric(rate, title: "Actions / sec", x: 180)
        latency.toolTip = "Median System One request latency for this task, in milliseconds."
        rate.toolTip = "Completed model-selected actions per second since the first decision started. Includes tool execution and observations; excludes initial planning."
        editor.onChange = { [weak self] in self?.updateRunButton() }
        baseFrames = view.subviews.filter { $0.frame.minY >= 105 }.map { ($0, $0.frame) }
        setStatus("Ready", color: .secondaryLabelColor)
        updateRunButton()
    }

    private func addEditor() {
        let scroll = NSScrollView(frame: NSRect(x: 18, y: 150, width: 324, height: 91))
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.wantsLayer = true
        scroll.layer?.cornerRadius = 8
        scroll.layer?.borderWidth = 0.5
        scroll.layer?.borderColor = NSColor.separatorColor.cgColor
        scroll.layer?.masksToBounds = true
        scroll.drawsBackground = true
        let fieldBackground = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.97, alpha: 1)
        }
        scroll.backgroundColor = fieldBackground
        editor.frame = NSRect(x: 0, y: 0, width: 324, height: 91)
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

    private func metric(_ value: NSTextField, title: String, x: CGFloat) {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 10)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        value.alignment = .center
        label.frame = NSRect(x: x, y: 33, width: 162, height: 14)
        value.font = .monospacedDigitSystemFont(ofSize: 14, weight: .medium)
        value.frame = NSRect(x: x, y: 13, width: 162, height: 18)
        view.addSubview(label)
        view.addSubview(value)
    }

    func setStatus(_ message: String, color: NSColor) {
        let measured = (message as NSString).boundingRect(
            with: NSSize(width: 324, height: 500), options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: NSFont.systemFont(ofSize: 11)])
        let height = max(28, ceil(measured.height) + 16)
        let delta = height - 28
        for (child, frame) in baseFrames { child.frame = frame.offsetBy(dx: 0, dy: delta) }
        status.frame.size.height = height
        let size = NSSize(width: Self.size.width, height: Self.size.height + height - 28)
        view.setFrameSize(size)
        preferredContentSize = size
        onSizeChange?(size)
        status.stringValue = message
        status.textColor = color
        status.toolTip = message
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

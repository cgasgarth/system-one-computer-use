import AppKit

@MainActor
final class TranscriptView: NSTextView {
    var onPaste: (() -> Void)?
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
    override func didChangeText() { super.didChangeText(); needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if string.isEmpty {
            ("What would you like to do?" as NSString).draw(at: NSPoint(x: 13, y: 12), withAttributes: [
                .font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.placeholderTextColor,
            ])
        }
    }
}

@MainActor
final class TaskMenu: NSViewController {
    let editor = TranscriptView()
    let mode = NSPopUpButton()
    let status = NSTextField(wrappingLabelWithString: "Ready when you are.")
    let run = NSButton(title: "Run task", target: nil, action: nil)
    let voice = NSButton(title: "Dictate", target: nil, action: nil)
    let cancel = NSButton(title: "Stop", target: nil, action: nil)
    let settings = NSButton(title: "Settings", target: nil, action: nil)
    let quit = NSButton(title: "Quit", target: nil, action: nil)
    let latency = NSTextField(labelWithString: "—")
    let rate = NSTextField(labelWithString: "—")
    let elapsed = NSTextField(labelWithString: "—")

    override func loadView() {
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 380, height: 412))
        view = content
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        let heading = NSTextField(labelWithString: "System One")
        heading.font = .systemFont(ofSize: 18, weight: .semibold)
        heading.frame = NSRect(x: 20, y: 372, width: 210, height: 24)
        content.addSubview(heading)
        let caption = NSTextField(labelWithString: "Your words. Computer actions.")
        caption.font = .systemFont(ofSize: 12)
        caption.textColor = .secondaryLabelColor
        caption.frame = NSRect(x: 20, y: 354, width: 260, height: 16)
        content.addSubview(caption)
        mode.frame = NSRect(x: 20, y: 311, width: 340, height: 28)
        mode.addItems(withTitles: ["Any · let the model choose", "Chrome", "macOS"])
        mode.setAccessibilityLabel("Computer")
        content.addSubview(mode)
        let scroll = NSScrollView(frame: NSRect(x: 20, y: 196, width: 340, height: 100))
        scroll.hasVerticalScroller = true
        scroll.wantsLayer = true
        scroll.layer?.cornerRadius = 8
        scroll.layer?.borderWidth = 1
        scroll.layer?.borderColor = NSColor.separatorColor.cgColor
        editor.frame = scroll.bounds
        editor.isRichText = false
        editor.font = .systemFont(ofSize: 14)
        editor.textContainerInset = NSSize(width: 8, height: 10)
        editor.autoresizingMask = [.width]
        editor.isVerticallyResizable = true
        editor.textContainer?.widthTracksTextView = true
        editor.setAccessibilityLabel("Task")
        scroll.documentView = editor
        content.addSubview(scroll)
        voice.frame = NSRect(x: 16, y: 156, width: 115, height: 30)
        voice.image = NSImage(systemSymbolName: "mic", accessibilityDescription: nil)
        voice.imagePosition = .imageLeading
        run.frame = NSRect(x: 246, y: 156, width: 118, height: 30)
        run.bezelColor = .controlAccentColor
        run.keyEquivalent = "\r"
        cancel.frame = NSRect(x: 165, y: 156, width: 75, height: 30)
        for button in [voice, run, cancel] { button.bezelStyle = .rounded; content.addSubview(button) }
        cancel.isEnabled = false
        cancel.isHidden = true
        status.frame = NSRect(x: 20, y: 105, width: 340, height: 40)
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        content.addSubview(status)
        metric(latency, title: "AVG REQUEST", x: 20)
        metric(rate, title: "REQUESTS / S", x: 137)
        metric(elapsed, title: "TASK TIME", x: 254)
        latency.toolTip = "Mean System One inference time. Excludes planning and computer operations."
        rate.toolTip = "Completed System One decisions divided by total task time, including planning and computer operations."
        let line = NSBox(frame: NSRect(x: 20, y: 41, width: 340, height: 1))
        line.boxType = .separator
        content.addSubview(line)
        settings.frame = NSRect(x: 16, y: 8, width: 120, height: 26)
        settings.bezelStyle = .inline
        settings.alignment = .left
        settings.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: nil)
        settings.imagePosition = .imageLeading
        content.addSubview(settings)
        quit.frame = NSRect(x: 308, y: 8, width: 54, height: 26)
        quit.bezelStyle = .inline
        content.addSubview(quit)
    }

    private func metric(_ value: NSTextField, title: String, x: CGFloat) {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 9, weight: .medium)
        label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: x, y: 79, width: 105, height: 14)
        value.font = .monospacedDigitSystemFont(ofSize: 18, weight: .medium)
        value.frame = NSRect(x: x, y: 53, width: 105, height: 25)
        view.addSubview(label)
        view.addSubview(value)
    }

    func focus() { view.window?.makeFirstResponder(editor) }
}

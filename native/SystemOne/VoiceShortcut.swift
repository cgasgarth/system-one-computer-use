import AppKit
import Carbon

struct ShortcutValue: Codable {
    let keyCode: UInt32
    let modifiers: UInt32
    let label: String
    static let standard = ShortcutValue(keyCode: UInt32(kVK_ANSI_C), modifiers: UInt32(cmdKey | optionKey), label: "⌘⌥C")
}

@MainActor
final class VoiceShortcut {
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var monitor: Any?
    private(set) var value = ShortcutValue.standard
    private var pressed = false
    var onPress: (() -> Void)?
    var onRelease: (() -> Void)?
    var onChange: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func start() {
        var specs = [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)), EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))]
        let callback: EventHandlerUPP = { _, event, context in
            guard let context, let event else { return noErr }
            MainActor.assumeIsolated {
                Unmanaged<VoiceShortcut>.fromOpaque(context).takeUnretainedValue().edge(GetEventKind(event))
            }
            return noErr
        }
        InstallEventHandler(GetApplicationEventTarget(), callback, specs.count, &specs,
                            Unmanaged.passUnretained(self).toOpaque(), &handler)
        if let data = UserDefaults.standard.data(forKey: "voiceShortcut"),
           let saved = try? JSONDecoder().decode(ShortcutValue.self, from: data) { value = saved }
        register(value)
    }

    private func edge(_ kind: UInt32) {
        if kind == UInt32(kEventHotKeyPressed) {
            guard !pressed else { return }; pressed = true; onPress?()
        } else if kind == UInt32(kEventHotKeyReleased) {
            guard pressed else { return }; pressed = false; onRelease?()
        }
    }

    private func register(_ candidate: ShortcutValue) {
        if reference != nil && candidate.keyCode == value.keyCode && candidate.modifiers == value.modifiers {
            onChange?(value.label)
            return
        }
        var next: EventHotKeyRef?
        let status = RegisterEventHotKey(candidate.keyCode, candidate.modifiers,
            EventHotKeyID(signature: 0x534F4355, id: 1), GetApplicationEventTarget(), 0, &next)
        guard status == noErr else {
            onChange?(value.label)
            onError?("That shortcut is already used by another app. Choose another combination.")
            return
        }
        if let reference { UnregisterEventHotKey(reference) }
        reference = next
        value = candidate
        if let data = try? JSONEncoder().encode(candidate) { UserDefaults.standard.set(data, forKey: "voiceShortcut") }
        onChange?(candidate.label)
    }

    func record() {
        stopRecording()
        onChange?("Press shortcut… (Esc cancels)")
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            MainActor.assumeIsolated {
                self?.capture(event)
            }
            return nil
        }
    }

    private func capture(_ event: NSEvent) {
        if event.keyCode == UInt16(kVK_Escape) { stopRecording(); onChange?(value.label); return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command) || flags.contains(.control) || flags.contains(.option) else {
            onError?("Use Command, Control, or Option with a key.")
            return
        }
        var modifiers: UInt32 = 0
        var label = ""
        for (flag, mask, symbol) in [(NSEvent.ModifierFlags.control, controlKey, "⌃"),
            (.option, optionKey, "⌥"), (.shift, shiftKey, "⇧"), (.command, cmdKey, "⌘")] {
            if flags.contains(flag) { modifiers |= UInt32(mask); label += symbol }
        }
        label += event.charactersIgnoringModifiers?.uppercased() ?? "Key \(event.keyCode)"
        stopRecording()
        register(ShortcutValue(keyCode: UInt32(event.keyCode), modifiers: modifiers, label: label))
    }

    func stopRecording() {
        if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
    }

    func stop() {
        stopRecording()
        if let reference { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
    }
}

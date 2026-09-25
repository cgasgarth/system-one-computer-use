import Foundation

struct HandyBehavior: Decodable {
    enum Mode: String, Decodable { case hold = "push_to_talk", auto = "hold_or_toggle", toggle }
    let mode: Mode
    let holdThresholdMilliseconds: UInt64
    enum CodingKeys: String, CodingKey { case mode = "shortcut_activation", holdThresholdMilliseconds = "hold_threshold_ms" }
    static func read() throws -> HandyBehavior {
        struct Store: Decodable { let settings: HandyBehavior }
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/com.pais.handy/settings_store.json")
        return try JSONDecoder().decode(Store.self, from: Data(contentsOf: file)).settings
    }
    var label: String { switch mode { case .hold: return "Hold"; case .auto: return "Auto"; case .toggle: return "Toggle" } }
}

struct VoiceActivation {
    enum Effect: Equatable { case start, stop, none }
    private var startedAt: TimeInterval?
    private var locked = false
    mutating func press(_ behavior: HandyBehavior, at now: TimeInterval) -> Effect {
        if startedAt == nil { startedAt = now; locked = behavior.mode == .toggle; return .start }
        if locked || behavior.mode == .toggle { reset(); return .stop }
        return .none
    }
    mutating func release(_ behavior: HandyBehavior, at now: TimeInterval) -> Effect {
        guard let startedAt, !locked, behavior.mode != .toggle else { return .none }
        let threshold = behavior.mode == .hold ? 0 : Double(behavior.holdThresholdMilliseconds) / 1000
        if now - startedAt >= threshold { reset(); return .stop }
        locked = true
        return .none
    }
    mutating func reset() { startedAt = nil; locked = false }
}

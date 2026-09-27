import AppKit
import ApplicationServices

struct FieldFrame: Codable {
    let x: Double; let y: Double; let w: Double; let h: Double
    func matches(_ other: FieldFrame) -> Bool {
        abs(x - other.x) < 1 && abs(y - other.y) < 1 && abs(w - other.w) < 1 && abs(h - other.h) < 1
    }
}
struct FieldCapability: Encodable {
    let role: String
    let frame: FieldFrame
    let editable: Bool
    let subrole: String?
    let value: String?
    let placeholder: String?
    let focused: Bool?
}
struct FieldResponse: Encodable {
    let fields: [FieldCapability]
    let labels: [LabelCapability]
    let complete: Bool
}
struct LabelCapability: Encodable {
    let role: String
    let frame: FieldFrame
    let label: String
}
struct DocumentResponse: Encodable { let url: String? }

@MainActor
enum WritableFields {
    private static let maximumLabelLength = 200
    static func attribute(_ node: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(node, name as CFString, &value) == .success ? value : nil
    }
    static func frame(_ node: AXUIElement) -> FieldFrame? {
        guard let position = attribute(node, kAXPositionAttribute), let size = attribute(node, kAXSizeAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero; var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return FieldFrame(x: point.x, y: point.y, w: dimensions.width, h: dimensions.height)
    }
    private static func text(_ node: AXUIElement, _ name: String) -> String? {
        guard let raw = attribute(node, name) as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed.count > maximumLabelLength ? nil : trimmed
    }
    private static func label(_ node: AXUIElement) -> String? {
        let own = Set([kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].compactMap { text(node, $0) })
        if own.count == 1 { return own.first }
        if !own.isEmpty { return nil }
        var descendants = Set<String>()
        func walk(_ child: AXUIElement, depth: Int) {
            guard depth < 4, descendants.count < 2 else { return }
            if attribute(child, kAXRoleAttribute) as? String == kAXStaticTextRole {
                for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
                    if let content = text(child, key) { descendants.insert(content) }
                }
            }
            for next in attribute(child, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(next, depth: depth + 1) }
        }
        for child in attribute(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(child, depth: 0) }
        return descendants.count == 1 ? descendants.first : nil
    }
    private static func exactWindow(pid: pid_t, expected: FieldFrame) throws -> AXUIElement {
        guard AXIsProcessTrusted() else { throw NativeAccessError.message("System One needs Accessibility access to inspect this window.") }
        let app = AXUIElementCreateApplication(pid)
        let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
        let matches = windows.filter { frame($0)?.matches(expected) == true }
        guard matches.count == 1, let window = matches.first else {
            throw NativeAccessError.message("The window moved or could not be identified while reading its metadata.")
        }
        return window
    }
    static func document(pid: pid_t, expected: FieldFrame) throws -> DocumentResponse {
        let window = try exactWindow(pid: pid, expected: expected)
        guard let raw = attribute(window, "AXDocument") as? String,
              let address = URL(string: raw), address.scheme != nil else { return DocumentResponse(url: nil) }
        return DocumentResponse(url: address.absoluteString)
    }
    static func read(pid: pid_t, expected: FieldFrame) throws -> FieldResponse {
        let window = try exactWindow(pid: pid, expected: expected)
        var visited = 0; var complete = true; var fields: [FieldCapability] = []; var labels: [LabelCapability] = []
        func walk(_ node: AXUIElement, depth: Int) {
            guard depth < 25, visited < 2000 else { complete = false; return }
            visited += 1
            if let role = attribute(node, kAXRoleAttribute) as? String,
               [kAXRowRole, kAXCellRole].contains(role),
               let bounds = frame(node), bounds.w > 1, bounds.h > 1,
               let name = label(node) {
                labels.append(LabelCapability(role: role, frame: bounds, label: name))
            }
            if let role = attribute(node, kAXRoleAttribute) as? String,
               [kAXTextAreaRole, kAXTextFieldRole, kAXComboBoxRole].contains(role),
               let bounds = frame(node), bounds.w > 1, bounds.h > 1 {
                var settable = DarwinBoolean(false)
                let result = AXUIElementIsAttributeSettable(node, kAXSelectedTextAttribute as CFString, &settable)
                var valueSettable = DarwinBoolean(false)
                let valueResult = AXUIElementIsAttributeSettable(node, kAXValueAttribute as CFString, &valueSettable)
                let editable = valueResult == .success && valueSettable.boolValue &&
                    (role != kAXTextAreaRole || (result == .success && settable.boolValue))
                fields.append(FieldCapability(role: role, frame: bounds, editable: editable,
                    subrole: attribute(node, kAXSubroleAttribute) as? String,
                    value: attribute(node, kAXValueAttribute) as? String,
                    placeholder: attribute(node, kAXPlaceholderValueAttribute) as? String,
                    focused: attribute(node, kAXFocusedAttribute) as? Bool))
            }
            for child in attribute(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(child, depth: depth + 1) }
        }
        walk(window, depth: 0)
        return FieldResponse(fields: fields, labels: complete ? labels : [], complete: complete)
    }
}

enum NativeAccessError: Error {
    case message(String)
}

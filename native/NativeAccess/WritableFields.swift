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
    let value: String?
    let placeholder: String?
    let focused: Bool?
}
struct FieldResponse: Encodable {
    let fields: [FieldCapability]
    let complete: Bool
}

@MainActor
enum WritableFields {
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
    static func read(pid: pid_t, expected: FieldFrame) throws -> FieldResponse {
        guard AXIsProcessTrusted() else { throw NativeAccessError.message("System One needs Accessibility access to inspect text fields.") }
        let app = AXUIElementCreateApplication(pid)
        let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
        let matches = windows.filter { frame($0)?.matches(expected) == true }
        guard matches.count == 1, let window = matches.first else {
            throw NativeAccessError.message("The window moved or could not be identified while checking its text fields.")
        }
        var visited = 0; var complete = true; var fields: [FieldCapability] = []
        func walk(_ node: AXUIElement, depth: Int) {
            guard depth < 25, visited < 2000 else { complete = false; return }
            visited += 1
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
                    value: attribute(node, kAXValueAttribute) as? String,
                    placeholder: attribute(node, kAXPlaceholderValueAttribute) as? String,
                    focused: attribute(node, kAXFocusedAttribute) as? Bool))
            }
            for child in attribute(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(child, depth: depth + 1) }
        }
        walk(window, depth: 0)
        return FieldResponse(fields: fields, complete: complete)
    }
}

enum NativeAccessError: Error {
    case message(String)
}

import ApplicationServices
import Foundation

struct MenuChoice: Encodable {
    let path: [String]
    let label: String
    let enabled: Bool
    let shortcut: String?
}

struct MenuReport: Encodable {
    let pid: Int32
    let menus: [MenuChoice]
}

enum MenuItems {
    private static let maximumDepth = 8
    private static let maximumNodes = 500
    private static let maximumChoices = 250

    static func read(pid: Int32) -> MenuReport {
        guard pid > 0, AXIsProcessTrusted() else { return MenuReport(pid: pid, menus: []) }
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 0.5)
        guard let menuValue = value(application, kAXMenuBarAttribute as CFString),
              CFGetTypeID(menuValue) == AXUIElementGetTypeID() else {
            return MenuReport(pid: pid, menus: [])
        }
        let menuBar = menuValue as! AXUIElement
        var visited = 0
        var choices: [MenuChoice] = []
        walk(menuBar, path: [], ancestorsEnabled: true, depth: 0, visited: &visited, choices: &choices)
        let unique = choices.filter { candidate in
            choices.filter { $0.path == candidate.path }.count == 1
        }
        return MenuReport(pid: pid, menus: Array(unique.prefix(maximumChoices)))
    }

    private static func value(_ element: AXUIElement, _ key: CFString) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, key, &result) == .success ? result : nil
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement]? {
        var result: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &result)
        if error == .noValue { return [] }
        guard error == .success else { return nil }
        return result == nil ? [] : result as? [AXUIElement]
    }

    private static func title(_ element: AXUIElement) -> String? {
        (value(element, kAXTitleAttribute as CFString) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func walk(
        _ element: AXUIElement,
        path: [String],
        ancestorsEnabled: Bool,
        depth: Int,
        visited: inout Int,
        choices: inout [MenuChoice]
    ) {
        guard depth <= maximumDepth, visited < maximumNodes, choices.count < maximumChoices else { return }
        visited += 1
        AXUIElementSetMessagingTimeout(element, 0.5)
        let role = value(element, kAXRoleAttribute as CFString) as? String
        let name = title(element)
        let nextPath: [String]
        if let name, !name.isEmpty, name != path.last {
            nextPath = path + [name]
        } else {
            nextPath = path
        }
        let ownEnabled = value(element, kAXEnabledAttribute as CFString) as? Bool
        let structural = role == "AXMenuBar" || role == "AXMenu"
        let enabled = ancestorsEnabled && (ownEnabled ?? structural)
        guard let descendants = children(element) else { return }
        if role == "AXMenuItem", descendants.isEmpty, nextPath.count >= 2, let label = nextPath.last {
            let shortcut = value(element, "AXMenuItemCmdChar" as CFString) as? String
            choices.append(MenuChoice(path: nextPath, label: label, enabled: enabled, shortcut: shortcut))
            return
        }
        let menus = descendants.filter { value($0, kAXRoleAttribute as CFString) as? String == "AXMenu" }
        if menus.count == 1, let menu = menus.first {
            walk(menu, path: nextPath, ancestorsEnabled: enabled, depth: depth + 1, visited: &visited, choices: &choices)
        }
        let titled = descendants.compactMap { child -> (AXUIElement, String)? in
            guard value(child, kAXRoleAttribute as CFString) as? String != "AXMenu" else { return nil }
            guard let name = title(child), !name.isEmpty else { return nil }
            return (child, name)
        }
        for (child, name) in titled where titled.filter({ $0.1 == name }).count == 1 {
            walk(child, path: nextPath, ancestorsEnabled: enabled, depth: depth + 1, visited: &visited, choices: &choices)
        }
    }
}

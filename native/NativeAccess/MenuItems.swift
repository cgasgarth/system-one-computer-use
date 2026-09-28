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
    let menuNames: [String]
    let menus: [MenuChoice]
    let complete: Bool
}

enum MenuItems {
    private static let maximumDepth = 8
    private static let maximumNodes = 500
    private static let maximumChoices = 250

    static func read(pid: Int32, topLevel: String? = nil) throws -> MenuReport {
        guard pid > 0, AXIsProcessTrusted() else {
            if topLevel != nil { throw NativeAccessError.message("Accessibility cannot inspect this menu.") }
            return MenuReport(pid: pid, menuNames: [], menus: [], complete: false)
        }
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 0.5)
        guard let menuValue = value(application, kAXMenuBarAttribute as CFString),
              CFGetTypeID(menuValue) == AXUIElementGetTypeID() else {
            if topLevel != nil { throw NativeAccessError.message("The application menu bar is unavailable.") }
            return MenuReport(pid: pid, menuNames: [], menus: [], complete: false)
        }
        let menuBar = menuValue as! AXUIElement
        guard let topItems = children(menuBar) else {
            if topLevel != nil { throw NativeAccessError.message("The application menu bar could not be read.") }
            return MenuReport(pid: pid, menuNames: [], menus: [], complete: false)
        }
        let titled = topItems.compactMap { item -> (AXUIElement, String)? in
            guard value(item, kAXRoleAttribute as CFString) as? String == "AXMenuBarItem" else { return nil }
            guard let name = title(item), !name.isEmpty else { return nil }
            return (item, name)
        }
        let names = titled.map { $0.1 }
        let menuNames = names.filter { name in names.filter { $0 == name }.count == 1 }
        if let topLevel, menuNames.filter({ $0 == topLevel }).count != 1 {
            throw NativeAccessError.message("The selected top-level menu is missing or ambiguous.")
        }
        let selected: AXUIElement
        if let topLevel {
            guard let item = titled.first(where: { $0.1 == topLevel }) else {
                throw NativeAccessError.message("The selected top-level menu is unavailable.")
            }
            selected = item.0
        } else {
            selected = menuBar
        }
        var visited = 0
        var choices: [MenuChoice] = []
        var complete = names.count == menuNames.count
        walk(selected, path: [], ancestorsEnabled: true, depth: 0,
             visited: &visited, choices: &choices, complete: &complete)
        let unique = choices.filter { candidate in
            choices.filter { $0.path == candidate.path }.count == 1
        }
        if unique.count != choices.count { complete = false }
        return MenuReport(pid: pid, menuNames: menuNames,
                          menus: Array(unique.prefix(maximumChoices)), complete: complete)
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
        choices: inout [MenuChoice],
        complete: inout Bool
    ) {
        guard depth <= maximumDepth, visited < maximumNodes, choices.count < maximumChoices else {
            complete = false
            return
        }
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
        guard let descendants = children(element) else { complete = false; return }
        if role == "AXMenuItem", descendants.isEmpty, nextPath.count >= 2, let label = nextPath.last {
            let shortcut = value(element, "AXMenuItemCmdChar" as CFString) as? String
            choices.append(MenuChoice(path: nextPath, label: label, enabled: enabled, shortcut: shortcut))
            return
        }
        let menus = descendants.filter { value($0, kAXRoleAttribute as CFString) as? String == "AXMenu" }
        if menus.count == 1, let menu = menus.first {
            walk(menu, path: nextPath, ancestorsEnabled: enabled, depth: depth + 1,
                 visited: &visited, choices: &choices, complete: &complete)
        } else if menus.count > 1 {
            complete = false
        }
        let titled = descendants.compactMap { child -> (AXUIElement, String)? in
            guard value(child, kAXRoleAttribute as CFString) as? String != "AXMenu" else { return nil }
            guard let name = title(child), !name.isEmpty else { return nil }
            return (child, name)
        }
        for (child, name) in titled {
            if titled.filter({ $0.1 == name }).count != 1 { complete = false; continue }
            walk(child, path: nextPath, ancestorsEnabled: enabled, depth: depth + 1,
                 visited: &visited, choices: &choices, complete: &complete)
        }
    }
}

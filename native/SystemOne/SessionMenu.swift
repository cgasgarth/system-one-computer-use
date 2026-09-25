import AppKit

struct SessionSelection: Encodable {
    enum Mode: String, Encodable { case auto, new, resume }
    let mode: Mode
    var id: String? = nil
}
struct RecentSession: Decodable { let id: UUID; let title: String; let lastUsedAt: Double }
struct SessionIndex: Decodable { let activeId: UUID?; let sessions: [RecentSession] }

@MainActor
final class SessionMenu {
    let picker = NSPopUpButton()
    init() {
        picker.setAccessibilityLabel("Session")
        picker.toolTip = "Automatic continues the active session unless it has been idle for more than one hour."
        picker.cell?.lineBreakMode = .byTruncatingTail
        refresh()
    }
    var selection: SessionSelection {
        let value = picker.selectedItem?.representedObject as? String ?? "auto"
        if value == "new" { return SessionSelection(mode:.new) }
        if let id = UUID(uuidString:value) { return SessionSelection(mode:.resume,id:id.uuidString.lowercased()) }
        return SessionSelection(mode:.auto)
    }
    func resetSelection() { picker.selectItem(at:0) }
    func refresh() {
        let selected = picker.selectedItem?.representedObject as? String ?? "auto"
        picker.removeAllItems()
        picker.addItem(withTitle:"Automatic"); picker.lastItem?.representedObject = "auto"
        picker.addItem(withTitle:"New session"); picker.lastItem?.representedObject = "new"
        guard let root = Bundle.main.object(forInfoDictionaryKey:"AppDataPath") as? String else { return }
        let file = URL(fileURLWithPath:root).appendingPathComponent("sessions/index.json")
        guard FileManager.default.fileExists(atPath:file.path) else { return }
        do {
            let index = try JSONDecoder().decode(SessionIndex.self,from:Data(contentsOf:file))
            if !index.sessions.isEmpty { picker.menu?.addItem(.separator()) }
            for session in index.sessions {
                picker.addItem(withTitle:session.title)
                picker.lastItem?.representedObject = session.id.uuidString.lowercased()
                picker.lastItem?.toolTip = "Continue this session · \(Date(timeIntervalSince1970:session.lastUsedAt / 1000).formatted())"
            }
            if let item = picker.itemArray.first(where:{$0.representedObject as? String == selected}) { picker.select(item) }
        } catch { picker.toolTip = "Could not read recent sessions: \(error.localizedDescription)" }
    }
}

import AppKit

@main
@MainActor
struct TaskMenuLayoutTests {
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let menu = TaskMenu()
        menu.loadViewIfNeeded()
        menu.editor.string = "do 5 plus 5 in calculator app"
        menu.updateRunButton()
        let draft = menu.editor.string
        var resized = NSSize.zero
        menu.onResize = { resized = $0 }
        let originalRunY = menu.run.frame.minY
        let message = "The model stopped in Calculator before completing the task.\n" +
            "It entered the requested expression but did not choose the remaining action. " +
            "The task has stopped and computer control has been released. " +
            "You can edit the request above and try again. This final sentence must remain visible."
        menu.setStatus(message, color: .systemOrange)
        precondition(menu.status.stringValue == message)
        precondition(menu.status.lineBreakMode == .byWordWrapping)
        precondition(resized.height > TaskMenu.size.height)
        precondition(menu.status.frame.maxY < menu.run.frame.minY)
        precondition(menu.run.frame.minY > originalRunY)
        precondition(menu.editor.string == draft)
        guard let cell = menu.status.cell else { throw CocoaError(.coderValueNotFound) }
        let measured = cell.cellSize(forBounds: NSRect(x: 0, y: 0, width: menu.status.frame.width, height: .greatestFiniteMagnitude))
        precondition(menu.status.frame.height >= ceil(measured.height))
        let window = NSWindow(contentRect: menu.view.bounds, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = menu.view
        menu.view.layoutSubtreeIfNeeded()
        menu.view.displayIfNeeded()
        if let bitmap = menu.view.bitmapImageRepForCachingDisplay(in: menu.view.bounds) {
            menu.view.cacheDisplay(in: menu.view.bounds, to: bitmap)
            if let data = bitmap.representation(using: .png, properties: [:]) {
                try data.write(to: URL(fileURLWithPath: "runs/native-tests/task-menu-expanded.png"))
            }
        }
        menu.setStatus("Ready", color: .secondaryLabelColor)
        precondition(menu.preferredContentSize == TaskMenu.size)
        precondition(menu.run.frame.minY == originalRunY)
        precondition(menu.editor.string == draft)
        print("Task menu: wrapped status expands and shrinks without clipping, overlap, or lost draft.")
    }
}

import AppKit

@main
@MainActor
struct StatusActivityTests {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        defer { NSStatusBar.system.removeStatusItem(item) }
        guard let button = item.button else { fatalError("No status button") }
        let activity = StatusActivity()
        activity.attach(to: button)
        activity.update(.processing)
        precondition(activity.state == .processing && button.image == nil)
        precondition(button.subviews.contains { $0 is NSProgressIndicator })
        activity.complete()
        precondition(activity.state == .completed && button.image != nil)
        let completedAt = Date()
        RunLoop.main.run(until: completedAt.addingTimeInterval(4.8))
        precondition(activity.state == .completed, "Completion cleared before five seconds")
        RunLoop.main.run(until: completedAt.addingTimeInterval(5.2))
        precondition(activity.state == .idle, "Completion did not reset")
        activity.complete()
        activity.update(.processing)
        RunLoop.main.run(until: Date().addingTimeInterval(5.2))
        precondition(activity.state == .processing, "Old completion timer replaced active work")
        activity.update(.listening)
        precondition(activity.state == .listening && button.image != nil)
        activity.update(.idle)
        print("Status activity: spinner, five-second completion, new-task cancellation, and listening passed.")
    }
}

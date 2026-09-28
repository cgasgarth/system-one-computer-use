import AppKit

@main
@MainActor
struct PermissionTests {
    static func labels(in view: NSView) -> [String] {
        let current = (view as? NSTextField).map { [$0.stringValue] } ?? []
        return current + view.subviews.flatMap { labels(in: $0) }
    }

    static func buttons(in view: NSView) -> [NSButton] {
        let current = (view as? NSButton).map { [$0] } ?? []
        return current + view.subviews.flatMap { buttons(in: $0) }
    }

    static func main() {
        precondition(CodexSetupSnapshot.label(true) == "Enabled in Codex")
        precondition(CodexSetupSnapshot.label(false) == "Needs setup")
        precondition(CodexSetupSnapshot.label(nil) == "Unable to check")

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let section = PermissionSection()
        section.update(CodexSetupSnapshot(
            runtimeInstalled: false, computerUseEnabled: false, chromeEnabled: false
        ))
        let missing = labels(in: section)
        precondition(missing.contains("Not installed"))
        precondition(missing.filter { $0 == "Needs setup" }.count == 2)
        precondition(!missing.contains("Granted"))
        let download = buttons(in: section).filter { $0.title == "Download" }
        precondition(download.filter { !$0.isHidden }.count == 1)

        section.update(CodexSetupSnapshot(
            runtimeInstalled: true, computerUseEnabled: false, chromeEnabled: nil
        ))
        let setup = buttons(in: section).filter { $0.title == "Open Codex" }
        precondition(setup.filter { !$0.isHidden }.count == 2)
        precondition(labels(in: section).contains("Unable to check"))

        let ready = CodexSetupSnapshot(
            runtimeInstalled: true, computerUseEnabled: true, chromeEnabled: true
        )
        section.update(ready)
        precondition(buttons(in: section).filter { !$0.isHidden }.map(\.title) == ["Recheck", "Open Settings"])
        precondition(labels(in: section).filter { $0 == "Enabled in Codex" }.count == 2)
        section.refresh(using: { Thread.sleep(forTimeInterval: 0.2); return ready })
        section.refresh(using: {
            CodexSetupSnapshot(runtimeInstalled: false, computerUseEnabled: false, chromeEnabled: false)
        })
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        precondition(labels(in: section).contains("Not installed"), "An older setup result replaced the latest check")
        print("Codex setup labels, missing states, and refresh order passed.")
    }
}

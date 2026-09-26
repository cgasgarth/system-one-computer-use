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
        let granted = PermissionSnapshot(appAccessibility: true, helperAccessibility: true, driverAccessibility: true, driverScreenRecording: true)
        precondition(granted.systemOneAccessibility == .granted)
        let missing = PermissionSnapshot(appAccessibility: true, helperAccessibility: false, driverAccessibility: nil, driverScreenRecording: nil)
        precondition(missing.systemOneAccessibility == .missing)
        let unknown = PermissionSnapshot(appAccessibility: true, helperAccessibility: nil, driverAccessibility: nil, driverScreenRecording: nil)
        precondition(unknown.systemOneAccessibility == .unknown)
        precondition(PermissionSnapshot.state(nil) == .unknown)

        let payload = Data(#"{"accessibility":true,"screen_recording":false,"source":{"attribution":"driver-daemon","bundle_id":"com.trycua.driver"}}"#.utf8)
        let driver = PermissionProbe.driverStatus(payload)
        precondition(driver.accessibility == true && driver.screenRecording == false)
        let otherProcess = Data(#"{"accessibility":true,"screen_recording":true,"source":{"attribution":"caller","bundle_id":"com.example.terminal"}}"#.utf8)
        let rejected = PermissionProbe.driverStatus(otherProcess)
        precondition(rejected.accessibility == nil && rejected.screenRecording == nil)
        precondition(PermissionProbe.driverStatus(Data()).accessibility == nil)

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let section = PermissionSection()
        section.update(missing)
        let shown = labels(in: section)
        precondition(shown.contains("Needs access"))
        precondition(shown.contains("Unable to check"))
        precondition(shown.contains("Check in macOS"))
        section.update(granted)
        let links = buttons(in: section).filter { $0.title == "Open Settings" }
        precondition(links.filter { !$0.isHidden }.count == 1, "Only Handy should retain an Open button when grants are confirmed")
        section.refresh(using: { Thread.sleep(forTimeInterval: 0.2); return granted })
        section.refresh(using: { missing })
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        let latest = labels(in: section)
        precondition(latest.contains("Needs access") && !latest.contains("Granted"), "An older permission result replaced the latest check")
        for pane in PermissionPane.allCases { precondition(pane.url.scheme == "x-apple.systempreferences") }
        print("Permissions: owner attribution, missing/unknown states, and compact UI passed.")
    }
}

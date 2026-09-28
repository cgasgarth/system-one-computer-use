import AppKit

@main
@MainActor
struct TaskApprovalTests {
    static func buttons(in view: NSView) -> [NSButton] {
        let current = (view as? NSButton).map { [$0] } ?? []
        return current + view.subviews.flatMap { buttons(in: $0) }
    }
    static func textViews(in view: NSView) -> [NSTextView] {
        let current = (view as? NSTextView).map { [$0] } ?? []
        return current + view.subviews.flatMap { textViews(in: $0) }
    }

    static func main() throws {
        let requestId = UUID()
        let payload = Data(#"{"status":"approval_requested","requestId":"00000000-0000-4000-8000-000000000001","message":"Allow Calculator access?","canAllowTask":true,"app":"com.apple.calculator","tool":"get_app_state"}"#.utf8)
        let prompt = try JSONDecoder().decode(ApprovalPrompt.self, from: payload)
        precondition(prompt.app == "com.apple.calculator")
        precondition(prompt.tool == "get_app_state")
        precondition(prompt.canAllowTask)
        let response = ApprovalResponse(requestId: requestId, decision: .decline)
        let encoded = try JSONEncoder().encode(response)
        let responseText = String(decoding: encoded, as: UTF8.self)
        precondition(responseText.contains("\"kind\":\"approval_response\""))
        precondition(responseText.contains("\"decision\":\"decline\""))
        precondition(responseText.contains(requestId.uuidString), "Swift must emit its canonical uppercase UUID")
        let task = TaskInput(task: "Read Calculator", mode: "desktop", session: SessionSelection(mode: .auto), submittedAt: 1)
        let taskText = String(decoding: try JSONEncoder().encode(task), as: UTF8.self)
        precondition(taskText.contains("\"kind\":\"task\""))

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let menu = TaskMenu()
        menu.loadViewIfNeeded()
        menu.editor.string = "Preserve this draft"
        menu.showApproval(prompt)
        let titles = buttons(in: menu.view).map(\.title)
        precondition(titles.contains("Allow once") && titles.contains("Allow for task") && titles.contains("Decline"))
        let promptText = textViews(in: menu.view).map(\.string).joined(separator: "\n")
        precondition(promptText.contains("Allow Calculator access?"))
        precondition(!promptText.contains("com.apple.calculator") && !promptText.contains("get_app_state"))
        precondition(menu.editor.string == "Preserve this draft")
        menu.clearApproval()
        precondition(menu.editor.string == "Preserve this draft")
        print("Task approval wire and draft-preserving menu passed.")
    }
}

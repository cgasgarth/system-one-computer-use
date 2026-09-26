import AppKit

@MainActor
private final class ClickThroughSpinner: NSProgressIndicator {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@MainActor
final class StatusActivity {
    enum State { case idle, listening, processing, completed }
    private(set) var state = State.idle
    private let spinner = ClickThroughSpinner()
    private weak var button: NSStatusBarButton?
    private var completionTimer: Timer?

    func attach(to button: NSStatusBarButton) {
        self.button = button
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.usesThreadedAnimation = true
        spinner.isDisplayedWhenStopped = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.setAccessibilityElement(false)
        button.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            spinner.widthAnchor.constraint(equalToConstant: 16),
            spinner.heightAnchor.constraint(equalToConstant: 16),
        ])
        update(.idle)
    }

    func update(_ state: State) {
        completionTimer?.invalidate()
        completionTimer = nil
        self.state = state
        guard let button else { return }
        if state == .processing {
            button.image = nil
            button.setAccessibilityLabel("System One — Processing request")
            button.toolTip = "System One is working. Click to view progress or stop."
            spinner.startAnimation(nil)
        } else {
            spinner.stopAnimation(nil)
            let label: String
            let symbol: String
            switch state {
            case .listening: label = "System One — Listening"; symbol = "mic.fill"
            case .completed: label = "System One — Task complete"; symbol = "checkmark.circle.fill"
            case .idle, .processing: label = "System One Computer Use"; symbol = "cursorarrow.rays"
            }
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
            button.setAccessibilityLabel(label)
            button.toolTip = label
        }
    }

    func complete() {
        update(.completed)
        let timer = Timer(timeInterval: 5, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.update(.idle) }
        }
        completionTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }
}

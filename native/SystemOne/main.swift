import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
DispatchQueue.main.async { delegate.start() }
withExtendedLifetime(delegate) { app.run() }

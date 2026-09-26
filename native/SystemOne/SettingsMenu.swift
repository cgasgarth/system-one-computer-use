import AppKit

private final class SettingsScrollContent: NSView {
    override var isFlipped: Bool { true }
}

@MainActor
final class SettingsMenu: NSViewController, NSTextFieldDelegate {
    static let size = NSSize(width: 380, height: 470)
    let back = NSButton(title: "Back", target: nil, action: nil)
    let quit = NSButton(title: "Quit System One", target: nil, action: nil)
    let shortcut = NSButton(title: "Record shortcut", target: nil, action: nil)
    let mode = NSPopUpButton()
    let save = NSButton(title: "Save", target: nil, action: nil)
    let status = NSTextField(wrappingLabelWithString: "")
    let permissions = PermissionSection()
    private let tabs = NSSegmentedControl(labels: ["General", "Models", "Permissions"], trackingMode: .selectOne, target: nil, action: nil)
    private let generalPage = NSStackView()
    private let modelsPage = NSStackView()
    private let body = NSStackView()
    private let scroll = NSScrollView()
    private let scrollContent = SettingsScrollContent()
    private let decision = NSPopUpButton()
    private let writer = NSPopUpButton()
    private let retention = NSPopUpButton()
    private let decisionStatus = NSTextField(wrappingLabelWithString: "")
    private let writerStatus = NSTextField(wrappingLabelWithString: "")
    private let decisionUrl = NSTextField()
    private let decisionName = NSTextField()
    private let textUrl = NSTextField()
    private let textName = NSTextField()
    private let decisionEndpoint = NSStackView()
    private let textEndpoint = NSStackView()
    private var catalog: [ModelPreset] = []
    private var pendingEndpoints: Set<ModelRole> = []
    var maximumHeight: CGFloat?
    var onModelsChange: ((ModelPreferences) -> Void)?
    var onSizeChange: ((NSSize) -> Void)?

    override func loadView() {
        view = MenuSurface(frame: NSRect(origin: .zero, size: Self.size))
        view.wantsLayer = true
        let title = label("Settings", size: 17, weight: .semibold)
        back.isBordered = false
        back.font = .systemFont(ofSize: 12, weight: .medium)
        back.image = NSImage(systemSymbolName: "chevron.left", accessibilityDescription: nil)
        back.imagePosition = .imageLeading
        back.contentTintColor = .secondaryLabelColor
        back.setAccessibilityLabel("Back")
        let header = row([back, title, spacer()])
        tabs.selectedSegment = 0
        tabs.target = self
        tabs.action = #selector(tabChanged)
        tabs.setAccessibilityLabel("Settings section")
        for page in [generalPage, modelsPage, permissions] {
            page.orientation = .vertical
            page.alignment = .leading
            page.spacing = 12
        }
        buildGeneral()
        buildModels()
        body.orientation = .vertical
        body.alignment = .leading
        body.detachesHiddenViews = true
        body.translatesAutoresizingMaskIntoConstraints = false
        for page in [generalPage, modelsPage, permissions] {
            body.addArrangedSubview(page)
            page.widthAnchor.constraint(equalTo: body.widthAnchor).isActive = true
        }
        modelsPage.isHidden = true
        permissions.isHidden = true
        permissions.onLayoutChange = { [weak self] in self?.resize() }
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scrollContent.addSubview(body)
        scroll.documentView = scrollContent
        let headerRule = separator()
        let footerRule = separator()
        styleDetail(status)
        status.maximumNumberOfLines = 2
        save.bezelStyle = .rounded
        save.bezelColor = .controlAccentColor
        save.widthAnchor.constraint(equalToConstant: 76).isActive = true
        let footer = row([status, spacer(), save])
        for item in [header, tabs, headerRule, scroll, footerRule, footer] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            header.topAnchor.constraint(equalTo: view.topAnchor, constant: 14),
            tabs.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            tabs.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            tabs.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 14),
            headerRule.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            headerRule.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            headerRule.topAnchor.constraint(equalTo: tabs.bottomAnchor, constant: 12),
            headerRule.heightAnchor.constraint(equalToConstant: 1),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: headerRule.bottomAnchor, constant: 3),
            scroll.bottomAnchor.constraint(equalTo: footerRule.topAnchor, constant: -3),
            footerRule.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            footerRule.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            footerRule.heightAnchor.constraint(equalToConstant: 1),
            footerRule.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -12),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            footer.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -14),
            body.leadingAnchor.constraint(equalTo: scrollContent.leadingAnchor, constant: 20),
            body.trailingAnchor.constraint(equalTo: scrollContent.trailingAnchor, constant: -20),
            body.topAnchor.constraint(equalTo: scrollContent.topAnchor, constant: 14),
        ])
        resize()
    }

    private func buildGeneral() {
        shortcut.bezelStyle = .rounded
        shortcut.widthAnchor.constraint(equalToConstant: 120).isActive = true
        add(settingRow("Voice shortcut", control: shortcut), to: generalPage)
        add(detail("Handy starts dictation with this shortcut."), to: generalPage)
        add(separator(), to: generalPage)
        mode.addItems(withTitles: ["Auto", "Chrome", "Desktop"])
        mode.setAccessibilityLabel("Control surface")
        mode.toolTip = "Choose automatically, use Chrome, or use the macOS desktop."
        mode.widthAnchor.constraint(equalToConstant: 116).isActive = true
        add(settingRow("Control surface", control: mode), to: generalPage)
        add(separator(), to: generalPage)
        retention.addItems(withTitles: ["Keep loaded", "Unload after 5 minutes", "Unload after each task"])
        retention.target = self
        retention.action = #selector(modelChanged(_:))
        retention.widthAnchor.constraint(equalToConstant: 218).isActive = true
        add(settingRow("When idle", control: retention), to: generalPage)
        add(detail("Model files stay downloaded when memory is released."), to: generalPage)
        add(separator(), to: generalPage)
        quit.isBordered = false
        quit.font = .systemFont(ofSize: 12)
        quit.contentTintColor = .secondaryLabelColor
        add(quit, to: generalPage)
    }

    private func buildModels() {
        add(modelGroup(title: "Decision model", picker: decision, detail: decisionStatus), to: modelsPage)
        endpoints(decisionEndpoint, url: decisionUrl, name: decisionName)
        add(decisionEndpoint, to: modelsPage)
        add(separator(), to: modelsPage)
        add(modelGroup(title: "Text generation", picker: writer, detail: writerStatus), to: modelsPage)
        endpoints(textEndpoint, url: textUrl, name: textName)
        add(textEndpoint, to: modelsPage)
    }

    private func add(_ child: NSView, to page: NSStackView) {
        page.addArrangedSubview(child)
        child.widthAnchor.constraint(equalTo: page.widthAnchor).isActive = true
    }

    private func row(_ items: [NSView]) -> NSStackView {
        let row = NSStackView(views: items)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        return row
    }

    private func settingRow(_ title: String, control: NSView) -> NSStackView {
        row([label(title), spacer(), control])
    }

    private func spacer() -> NSView {
        let view = NSView()
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return view
    }

    private func label(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.setContentCompressionResistancePriority(.required, for: .horizontal)
        return field
    }

    private func detail(_ text: String) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        styleDetail(field)
        return field
    }

    private func separator() -> NSBox {
        let line = NSBox()
        line.boxType = .separator
        return line
    }

    private func styleDetail(_ field: NSTextField) {
        field.font = .systemFont(ofSize: 11)
        field.textColor = .secondaryLabelColor
        field.maximumNumberOfLines = 3
        field.lineBreakMode = .byWordWrapping
    }

    private func modelGroup(title: String, picker: NSPopUpButton, detail: NSTextField) -> NSStackView {
        picker.setAccessibilityLabel(title)
        picker.target = self
        picker.action = #selector(modelChanged)
        styleDetail(detail)
        let group = NSStackView(views: [label(title, weight: .semibold), picker, detail])
        group.orientation = .vertical
        group.alignment = .leading
        group.spacing = 7
        picker.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true
        detail.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true
        return group
    }

    private func endpoints(_ group: NSStackView, url: NSTextField, name: NSTextField) {
        group.orientation = .vertical
        group.alignment = .leading
        group.spacing = 8
        for (field, title) in [(url, "Endpoint URL"), (name, "Model ID")] {
            field.placeholderString = title
            field.setAccessibilityLabel(title)
            field.font = .systemFont(ofSize: 12)
            field.bezelStyle = .roundedBezel
            field.delegate = self
            group.addArrangedSubview(field)
            field.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true
        }
        group.isHidden = true
    }

    private var activePage: NSStackView {
        switch tabs.selectedSegment {
        case 1: modelsPage
        case 2: permissions
        default: generalPage
        }
    }

    private func resize() {
        scrollContent.setFrameSize(NSSize(width: Self.size.width, height: max(scrollContent.frame.height, Self.size.height)))
        scrollContent.layoutSubtreeIfNeeded()
        let page = activePage
        let visible = page.arrangedSubviews.filter { !$0.isHidden }
        let rowsHeight = visible.reduce(CGFloat.zero) { $0 + $1.fittingSize.height }
        let contentHeight = ceil(rowsHeight + CGFloat(max(0, visible.count - 1)) * page.spacing) + 28
        scrollContent.setFrameSize(NSSize(width: Self.size.width, height: contentHeight))
        scroll.reflectScrolledClipView(scroll.contentView)
        let size = NSSize(width: Self.size.width, height: min(Self.size.height, max(320, maximumHeight ?? Self.size.height)))
        view.setFrameSize(size)
        preferredContentSize = size
        onSizeChange?(size)
    }

    @objc private func tabChanged() {
        generalPage.isHidden = tabs.selectedSegment != 0
        modelsPage.isHidden = tabs.selectedSegment != 1
        permissions.isHidden = tabs.selectedSegment != 2
        resize()
        scroll.contentView.scroll(to: .zero)
        scroll.reflectScrolledClipView(scroll.contentView)
    }

    func load() {
        mode.selectItem(at: UserDefaults.standard.integer(forKey: "targetMode"))
        permissions.refresh()
        resize()
        scroll.contentView.scroll(to: .zero)
        scroll.reflectScrolledClipView(scroll.contentView)
    }

    func updateModels(_ event: ModelEvent) {
        guard let preferences = event.preferences, let catalog = event.catalog else { return }
        if self.catalog.isEmpty {
            self.catalog = catalog
            populate(decision, role: .decision)
            populate(writer, role: .text)
        }
        if pendingEndpoints.isEmpty {
            select(preferences.decision, picker: decision, url: decisionUrl, name: decisionName)
            select(preferences.text, picker: writer, url: textUrl, name: textName)
            retention.selectItem(at: preferences.retention == .warm ? 0 : preferences.retention == .fiveMinutes ? 1 : 2)
        }
        for model in event.models ?? [] {
            let field = model.role == .decision ? decisionStatus : writerStatus
            field.stringValue = model.message
            field.toolTip = model.message
            field.textColor = model.state == .error ? .systemOrange : .secondaryLabelColor
        }
        for role in pendingEndpoints {
            let field = role == .decision ? decisionStatus : writerStatus
            field.stringValue = "Save to apply this endpoint."
            field.toolTip = field.stringValue
            field.textColor = .secondaryLabelColor
        }
        if let error = event.models?.first(where: { $0.state == .error }) {
            status.stringValue = error.message
            status.toolTip = error.message
            status.textColor = .systemOrange
        } else if event.event == .status && status.stringValue == "Applying settings…" {
            status.stringValue = ""
            status.toolTip = nil
        }
        updateFields()
    }

    private func populate(_ picker: NSPopUpButton, role: ModelRole) {
        picker.removeAllItems()
        for model in catalog where model.role == role {
            picker.addItem(withTitle: model.name)
            picker.lastItem?.representedObject = model.id
        }
        picker.menu?.addItem(.separator())
        picker.addItem(withTitle: "Use an endpoint…")
        picker.lastItem?.representedObject = "endpoint"
    }

    private func select(_ selection: ModelSelection, picker: NSPopUpButton, url: NSTextField, name: NSTextField) {
        switch selection {
        case .local(let id):
            picker.selectItem(at: picker.itemArray.firstIndex(where: { $0.representedObject as? String == id }) ?? 0)
        case .endpoint(let address, let model):
            picker.select(picker.lastItem)
            url.stringValue = address
            name.stringValue = model
        }
    }

    private func updateFields() {
        decisionEndpoint.isHidden = decision.selectedItem?.representedObject as? String != "endpoint"
        textEndpoint.isHidden = writer.selectedItem?.representedObject as? String != "endpoint"
        resize()
    }

    @objc private func modelChanged(_ sender: NSControl) {
        updateFields()
        if sender === decision {
            if !decisionEndpoint.isHidden { pendingEndpoints.insert(.decision) }
            else { pendingEndpoints.remove(.decision) }
        }
        if sender === writer {
            if !textEndpoint.isHidden { pendingEndpoints.insert(.text) }
            else { pendingEndpoints.remove(.text) }
        }
        if pendingEndpoints.contains(.decision) { decisionStatus.stringValue = "Save to apply this endpoint." }
        if pendingEndpoints.contains(.text) { writerStatus.stringValue = "Save to apply this endpoint." }
        if pendingEndpoints.isEmpty { persist() }
    }

    func controlTextDidBeginEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        if field === decisionUrl || field === decisionName { pendingEndpoints.insert(.decision) }
        if field === textUrl || field === textName { pendingEndpoints.insert(.text) }
    }

    private func selection(_ picker: NSPopUpButton, url: NSTextField, name: NSTextField) -> ModelSelection {
        let id = picker.selectedItem?.representedObject as? String ?? ""
        return id == "endpoint" ? .endpoint(url: url.stringValue, model: name.stringValue) : .local(id)
    }

    func persist() {
        guard !catalog.isEmpty else { return }
        let preference = ModelPreferences(
            decision: selection(decision, url: decisionUrl, name: decisionName),
            text: selection(writer, url: textUrl, name: textName),
            retention: [Retention.warm, .fiveMinutes, .cold][retention.indexOfSelectedItem]
        )
        pendingEndpoints.removeAll()
        UserDefaults.standard.set(mode.indexOfSelectedItem, forKey: "targetMode")
        status.stringValue = "Applying settings…"
        status.textColor = .secondaryLabelColor
        onModelsChange?(preference)
    }
}

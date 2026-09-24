import AppKit

@MainActor
final class SettingsMenu: NSViewController, NSTextFieldDelegate {
    static let size = NSSize(width: 400, height: 510)
    let back = NSButton(title: "Back", target: nil, action: nil)
    let quit = NSButton(title: "Quit System One", target: nil, action: nil)
    let shortcut = NSButton(title: "Record shortcut", target: nil, action: nil)
    let mode = NSPopUpButton()
    let save = NSButton(title: "Save", target: nil, action: nil)
    let status = NSTextField(wrappingLabelWithString: "Loading model settings…")
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
    private let stack = NSStackView()
    private var catalog: [ModelPreset] = []
    private var editingEndpoint: ModelRole?
    var onModelsChange: ((ModelPreferences) -> Void)?
    var onSizeChange: ((NSSize) -> Void)?

    override func loadView() {
        view = MenuSurface(frame:NSRect(origin:.zero,size:Self.size)); view.wantsLayer = true
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.detachesHiddenViews = true; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:view.leadingAnchor,constant:20),stack.trailingAnchor.constraint(equalTo:view.trailingAnchor,constant:-20),stack.topAnchor.constraint(equalTo:view.topAnchor,constant:20)])
        back.bezelStyle = .inline
        add(row([back,label("Settings",weight:.semibold),spacer()]))
        shortcut.bezelStyle = .rounded
        shortcut.widthAnchor.constraint(equalToConstant:170).isActive = true
        add(row([label("Voice shortcut"),spacer(),shortcut]))
        mode.addItems(withTitles:["Any","Chrome","macOS"])
        mode.widthAnchor.constraint(equalToConstant:94).isActive = true
        add(row([label("Default computer"),spacer(),mode]))
        separator()
        add(modelGroup(title:"Decision model",picker:decision,detail:decisionStatus))
        endpoints(decisionEndpoint,url:decisionUrl,name:decisionName)
        add(modelGroup(title:"Text generation",picker:writer,detail:writerStatus))
        endpoints(textEndpoint,url:textUrl,name:textName)
        separator()
        retention.addItems(withTitles:["Keep loaded","Unload after 5 minutes","Unload after each task"])
        retention.target = self; retention.action = #selector(modelChanged(_:))
        retention.widthAnchor.constraint(equalToConstant:218).isActive = true
        add(row([label("When idle"),spacer(),retention]))
        styleDetail(status); add(status)
        save.bezelStyle = .rounded; save.bezelColor = .controlAccentColor
        save.widthAnchor.constraint(equalToConstant:74).isActive = true
        quit.bezelStyle = .inline
        add(row([quit,spacer(),save]))
        resize()
    }
    private func add(_ child:NSView) {
        stack.addArrangedSubview(child)
        child.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
    }
    private func row(_ items:[NSView]) -> NSStackView {
        let row = NSStackView(views:items); row.orientation = .horizontal; row.alignment = .centerY; row.spacing = 10
        return row
    }
    private func spacer() -> NSView {
        let view = NSView(); view.setContentHuggingPriority(.defaultLow,for:.horizontal)
        return view
    }
    private func label(_ text:String,weight:NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(labelWithString:text); field.font = .systemFont(ofSize:13,weight:weight)
        field.setContentCompressionResistancePriority(.required,for:.horizontal)
        return field
    }
    private func separator() { let line = NSBox(); line.boxType = .separator; add(line) }
    private func styleDetail(_ field:NSTextField) {
        field.font = .systemFont(ofSize:11); field.textColor = .secondaryLabelColor
        field.maximumNumberOfLines = 3; field.lineBreakMode = .byWordWrapping
    }
    private func modelGroup(title:String,picker:NSPopUpButton,detail:NSTextField) -> NSStackView {
        picker.setAccessibilityLabel(title); picker.target = self; picker.action = #selector(modelChanged)
        styleDetail(detail)
        let group = NSStackView(views:[label(title,weight:.semibold),picker,detail])
        group.orientation = .vertical; group.alignment = .leading; group.spacing = 5
        picker.widthAnchor.constraint(equalTo:group.widthAnchor).isActive = true
        detail.widthAnchor.constraint(equalTo:group.widthAnchor).isActive = true
        return group
    }
    private func endpoints(_ group:NSStackView,url:NSTextField,name:NSTextField) {
        group.orientation = .vertical; group.alignment = .leading; group.spacing = 8
        for (field,title) in [(url,"Endpoint URL"),(name,"Model ID")] {
            field.placeholderString = title; field.setAccessibilityLabel(title)
            field.font = .systemFont(ofSize:12); field.bezelStyle = .roundedBezel; field.delegate = self
            group.addArrangedSubview(field); field.widthAnchor.constraint(equalTo:group.widthAnchor).isActive = true
        }
        add(group); group.isHidden = true
    }
    private func resize() {
        view.layoutSubtreeIfNeeded()
        let size = NSSize(width:Self.size.width,height:ceil(stack.fittingSize.height)+40)
        view.setFrameSize(size); preferredContentSize = size; onSizeChange?(size)
    }
    func load() { mode.selectItem(at:UserDefaults.standard.integer(forKey:"targetMode")); resize() }
    func updateModels(_ event:ModelEvent) {
        guard let preferences = event.preferences, let catalog = event.catalog else { return }
        if self.catalog.isEmpty { self.catalog = catalog; populate(decision,role:.decision); populate(writer,role:.text) }
        if editingEndpoint == nil {
            select(preferences.decision,picker:decision,url:decisionUrl,name:decisionName)
            select(preferences.text,picker:writer,url:textUrl,name:textName)
            retention.selectItem(at:preferences.retention == .warm ? 0 : preferences.retention == .fiveMinutes ? 1 : 2)
        }
        for model in event.models ?? [] {
            let field = model.role == .decision ? decisionStatus : writerStatus
            field.stringValue = model.message; field.toolTip = model.message
            field.textColor = model.state == .error ? .systemOrange : .secondaryLabelColor
        }
        status.stringValue = "Model files stay downloaded when memory is released."
        updateFields()
    }
    private func populate(_ picker:NSPopUpButton,role:ModelRole) {
        picker.removeAllItems()
        for model in catalog where model.role == role { picker.addItem(withTitle:model.name); picker.lastItem?.representedObject = model.id }
        picker.menu?.addItem(.separator())
        picker.addItem(withTitle:"Use an endpoint…"); picker.lastItem?.representedObject = "endpoint"
    }
    private func select(_ selection:ModelSelection,picker:NSPopUpButton,url:NSTextField,name:NSTextField) {
        switch selection {
        case .local(let id): picker.selectItem(at:picker.itemArray.firstIndex(where:{$0.representedObject as? String == id}) ?? 0)
        case .endpoint(let address,let model): picker.select(picker.lastItem); url.stringValue = address; name.stringValue = model
        }
    }
    private func updateFields() {
        decisionEndpoint.isHidden = decision.selectedItem?.representedObject as? String != "endpoint"
        textEndpoint.isHidden = writer.selectedItem?.representedObject as? String != "endpoint"
        resize()
    }
    @objc private func modelChanged(_ sender:NSControl) {
        updateFields()
        if sender === decision {
            if !decisionEndpoint.isHidden { editingEndpoint = .decision }
            else if editingEndpoint == .decision { editingEndpoint = nil }
        }
        if sender === writer {
            if !textEndpoint.isHidden { editingEndpoint = .text }
            else if editingEndpoint == .text { editingEndpoint = nil }
        }
        if editingEndpoint == nil { persist() }
    }
    func controlTextDidBeginEditing(_ notification:Notification) {
        guard let field = notification.object as? NSTextField else { return }
        if field === decisionUrl || field === decisionName { editingEndpoint = .decision }
        if field === textUrl || field === textName { editingEndpoint = .text }
    }
    private func selection(_ picker:NSPopUpButton,url:NSTextField,name:NSTextField) -> ModelSelection {
        let id = picker.selectedItem?.representedObject as? String ?? ""
        return id == "endpoint" ? .endpoint(url:url.stringValue,model:name.stringValue) : .local(id)
    }
    func persist() {
        guard !catalog.isEmpty else { return }
        let preference = ModelPreferences(decision:selection(decision,url:decisionUrl,name:decisionName),text:selection(writer,url:textUrl,name:textName),retention:[Retention.warm,.fiveMinutes,.cold][retention.indexOfSelectedItem])
        editingEndpoint = nil
        UserDefaults.standard.set(mode.indexOfSelectedItem,forKey:"targetMode")
        status.stringValue = "Applying settings…"; onModelsChange?(preference)
    }
}

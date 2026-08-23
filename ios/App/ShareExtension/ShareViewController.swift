import UIKit
import UniformTypeIdentifiers

// The share target: another app shares text or a URL and it is saved as a
// pending chore name IMMEDIATELY, with a confirmation card as the only UI —
// the pattern proven in lifeGLANCE's share extension, adopted here after two
// rounds with a compose sheet. The sheet earned its keep by letting the user
// edit the name before saving, but the Add-chore form the share opens on next
// foreground is already an edit step, so the sheet was a second copy of it.
// Instant save + confirmation is less tapping for the same control.
//
// The confirmation card is not decoration. iOS bars app extensions from
// opening their host app (the responder-chain openURL trick died in iOS 18,
// by design), so a share can only land quietly in the App Group — and without
// UI, a quiet save is indistinguishable from a failed one. The card is that
// missing feedback, and its detail line says when the chore will appear.
//
// Name preference mirrors Android's captureSharedText: a title/subject over
// raw text over the URL, because a page title makes a better chore name.
//
// The runtime name is fixed as @objc(ShareViewController) and Info.plist's
// NSExtensionPrincipalClass is the bare string "ShareViewController" — the
// combination lifeGLANCE ships. If the @objc attribute is ever removed, the
// Info.plist key must change back to the module-qualified form in the same
// commit, or the extension fails to launch.
@objc(ShareViewController)
final class ShareViewController: UIViewController {

    private let card = UIView()
    private let headline = UILabel()
    private let detail = UILabel()
    private let doneButton = UIButton(type: .system)

    private let brandGreen = UIColor(
        red: 0x22 / 255, green: 0xC5 / 255, blue: 0x5E / 255, alpha: 1
    )

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        Task {
            let saved = await captureShare()
            show(saved: saved)
        }
    }

    // Extract the best available name and queue it. Returns what was captured,
    // or nil when the share held nothing usable.
    private func captureShare() async -> String? {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

        var subject = ""
        var body = ""

        for item in items {
            // attributedContentText is the shared text itself — or, for Safari
            // and Brave page shares, the page title. attributedTitle is an
            // explicit subject where the source app provides one. Either fills
            // the "subject" role Android's EXTRA_SUBJECT plays.
            if subject.isEmpty,
               let title = item.attributedTitle?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !title.isEmpty {
                subject = title
            }
            if subject.isEmpty,
               let content = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !content.isEmpty {
                subject = content
            }
            for provider in item.attachments ?? [] {
                if body.isEmpty, let url = await load(provider, as: UTType.url) {
                    body = url
                } else if body.isEmpty, let text = await load(provider, as: UTType.plainText) {
                    body = text
                }
            }
        }

        let name = subject.isEmpty ? body.trimmingCharacters(in: .whitespacesAndNewlines) : subject
        guard !name.isEmpty else { return nil }

        SharedDataStore.appendPendingSharedChore(name)
        return name
    }

    private func load(_ provider: NSItemProvider, as type: UTType) async -> String? {
        guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { return nil }
        let item = try? await provider.loadItem(forTypeIdentifier: type.identifier)
        if let url = item as? URL { return url.absoluteString }
        if let s = item as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let data = item as? Data, let s = String(data: data, encoding: .utf8),
           !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    // MARK: - UI
    // Same card lifeGLANCE draws, in lastGLANCE's clothes: system semantic
    // colours so it follows light/dark automatically (the widgets already use
    // systemBackground), and the brand green on the Done action.

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        card.alpha = 0
        view.addSubview(card)

        headline.font = .systemFont(ofSize: 17, weight: .semibold)
        headline.textColor = .label
        headline.numberOfLines = 1
        headline.textAlignment = .center

        detail.font = .systemFont(ofSize: 14)
        detail.textColor = .secondaryLabel
        detail.numberOfLines = 4
        detail.textAlignment = .center

        doneButton.setTitle(String(localized: "Done"), for: .normal)
        doneButton.setTitleColor(brandGreen, for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [headline, detail, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
        ])
    }

    private func show(saved: String?) {
        if let name = saved {
            headline.text = String(localized: "Saved to lastGLANCE")
            detail.text = String(localized: "\(name)\n\nIt'll be waiting as a new chore next time you open the app.")
        } else {
            headline.text = String(localized: "Nothing to save")
            detail.text = String(localized: "This item didn't contain any text or link lastGLANCE could use.")
        }
        UIView.animate(withDuration: 0.2) { self.card.alpha = 1 }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: [])
    }
}

import UIKit
import Social
import UniformTypeIdentifiers

// The share target: another app shares text or a URL, the user confirms in the
// standard compose sheet, and the chosen text lands in the App Group as
// pending_shared_chore — consumed by the existing consumeSharedChore path to
// open the new-chore form pre-filled on next app foreground. The direct analog
// of MainActivity.captureSharedText, with the same preference order: a title
// over the raw text/URL, because a page title makes a better chore name.
//
// The compose box is ALWAYS populated before the user acts. Text shares arrive
// with contentText pre-filled by the system; page/URL shares arrive with an
// empty box and only a URL attachment, so viewDidLoad walks the attachments and
// puts the title (or URL) into the box itself. First shipped without that, and
// a page share showed an empty sheet that saved something invisible on Post —
// technically correct and terrible: the whole point of the sheet is seeing and
// editing what will be saved.
//
// One deliberate UX difference from Android: an Android share launches the app
// immediately; an iOS share extension cannot reliably open its containing app,
// so confirming saves the name and the pre-filled form appears the next time
// the app opens.
class ShareViewController: SLComposeServiceViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        placeholder = "Chore name"
        prefillFromAttachmentsIfEmpty()
    }

    override func presentationAnimationDidFinish() {
        super.presentationAnimationDidFinish()
        renamePostButton()
    }

    // The sheet's confirm button says "Post" — SLComposeServiceViewController
    // was built for social feeds and offers no API to change it. The button is
    // an ordinary bar item on the sheet's internal navigation bar, so retitle
    // it there. Best-effort by design: if an iOS release rearranges the
    // internals, the title quietly stays "Post" instead of anything breaking.
    private func renamePostButton() {
        let bars = children.compactMap { ($0 as? UINavigationController)?.navigationBar }
            + (navigationController.map { [$0.navigationBar] } ?? [])
        for bar in bars {
            bar.topItem?.rightBarButtonItem?.title = "Add"
        }
    }

    // Page/URL shares put nothing in the compose box. Fetch the same value
    // didSelectPost would fall back to — title first, then URL — and make it
    // visible and editable up front.
    private func prefillFromAttachmentsIfEmpty() {
        guard (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

        for item in items {
            if let title = item.attributedTitle?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !title.isEmpty {
                setComposeText(title)
                return
            }
        }

        for item in items {
            for provider in item.attachments ?? []
            where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] value, _ in
                    let url = (value as? URL)?.absoluteString
                        ?? (value as? Data).flatMap { String(data: $0, encoding: .utf8) }
                    guard let url, !url.isEmpty else { return }
                    DispatchQueue.main.async {
                        self?.setComposeText(url)
                    }
                }
                return
            }
        }
    }

    private func setComposeText(_ text: String) {
        // Never clobber something the user has started typing in the meantime.
        guard (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        textView.text = text
        validateContent()
    }

    override func isContentValid() -> Bool {
        // Confirming an empty box is allowed: a late-arriving URL attachment may
        // still supply the name in didSelectPost's fallback walk.
        true
    }

    override func didSelectPost() {
        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        // The visible text wins outright — after the prefill above it is
        // literally what the user saw and approved. The walk below only matters
        // when the async URL prefill had not landed before they confirmed.
        if !typed.isEmpty {
            finish(with: typed)
            return
        }

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

        for item in items {
            if let title = item.attributedTitle?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !title.isEmpty {
                finish(with: title)
                return
            }
        }

        for item in items {
            for provider in item.attachments ?? []
            where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] value, _ in
                    let url = (value as? URL)?.absoluteString
                        ?? (value as? Data).flatMap { String(data: $0, encoding: .utf8) }
                    DispatchQueue.main.async {
                        self?.finish(with: url)
                    }
                }
                return
            }
        }

        finish(with: nil)
    }

    private func finish(with name: String?) {
        if let name, !name.isEmpty {
            SharedDataStore.writePendingSharedChore(name)
        }
        extensionContext?.completeRequest(returningItems: [])
    }

    override func configurationItems() -> [Any]! {
        // No options below the compose box; the sheet is just text + confirm.
        []
    }
}

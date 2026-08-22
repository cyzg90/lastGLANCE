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
// One deliberate UX difference from Android: an Android share launches the app
// immediately; an iOS share extension cannot reliably open its containing app,
// so the sheet's Post saves the name and the pre-filled form appears the next
// time the app opens. The compose sheet is what makes that acceptable — the
// user sees and can edit exactly what will be saved.
class ShareViewController: SLComposeServiceViewController {

    override func isContentValid() -> Bool {
        // Posting nothing is fine: the URL attachment may still supply the name.
        true
    }

    override func didSelectPost() {
        let typed = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        // The user's edited text wins outright — it is literally what they asked
        // to save. The attachment walk is only for shares that arrive with an
        // empty compose box (Safari URL shares commonly do).
        if !typed.isEmpty {
            finish(with: typed)
            return
        }

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

        // A provided title beats a raw URL, mirroring Android's EXTRA_SUBJECT
        // preference.
        for item in items {
            if let title = item.attributedTitle?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !title.isEmpty {
                finish(with: title)
                return
            }
        }

        // Fall back to the first URL attachment's absolute string.
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
        // No options below the compose box; the sheet is just text + Post.
        []
    }
}

import Foundation
import Capacitor
import Contacts
import UIKit

// Read-only access to the address book for People (docs: the People spec,
// Contacts integration and privacy), the iOS counterpart of
// ContactsPlugin.java. Same JS interface (src/native/contacts.ts) and the
// same shapes back, so the web side parses both the same way. lastGLANCE
// never writes to contacts, and nothing read here is stored natively.
//
// A contact is identified by CNContact.identifier, which is stable on this
// device and differs on every other, so links stay device-local.
//
// Dates go back as the strings Android sends ("1990-05-17", or "--05-17" with
// no year) with Android's event types (3 birthday, 1 anniversary, 0 custom
// with its label), so the tested parser in src/people/contacts.ts reads both.
//
// iOS 18 lets people share only some contacts. Limited access reads as
// granted: the store then simply returns the contacts they chose.
//
// Registered in BridgeViewController.capacitorDidLoad(), like the other
// app-local plugins. Capacitor runs plugin methods off the main thread, so
// the fetches here do not block the WebView.
@objc(ContactsPlugin)
public class ContactsPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "ContactsPlugin"
    public let jsName = "Contacts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private static let photoMaxBytes = 64 * 1024
    private let store = CNContactStore()

    // MARK: Permission

    private func permissionState() -> String {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if #available(iOS 18.0, *), status == .limited { return "granted" }
        switch status {
        case .authorized: return "granted"
        case .notDetermined: return "prompt"
        default: return "denied"
        }
    }

    @objc func checkPermission(_ call: CAPPluginCall) {
        call.resolve(["state": permissionState()])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        guard CNContactStore.authorizationStatus(for: .contacts) == .notDetermined else {
            call.resolve(["state": permissionState()])
            return
        }
        store.requestAccess(for: .contacts) { [weak self] _, _ in
            call.resolve(["state": self?.permissionState() ?? "denied"])
        }
    }

    // MARK: Reading

    private func nameKeys() -> [CNKeyDescriptor] {
        [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactOrganizationNameKey as CNKeyDescriptor,
        ]
    }

    private func displayName(_ c: CNContact) -> String {
        let full = CNContactFormatter.string(from: c, style: .fullName)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return full.isEmpty ? c.organizationName.trimmingCharacters(in: .whitespacesAndNewlines) : full
    }

    private func dateString(_ d: DateComponents) -> String? {
        guard let month = d.month, let day = d.day,
              month != NSDateComponentUndefined, day != NSDateComponentUndefined else { return nil }
        if let year = d.year, year != NSDateComponentUndefined {
            return String(format: "%04ld-%02ld-%02ld", year, month, day)
        }
        return String(format: "--%02ld-%02ld", month, day)
    }

    private func events(_ c: CNContact) -> [[String: Any]] {
        var out: [[String: Any]] = []
        if let birthday = c.birthday, let date = dateString(birthday) {
            out.append(["date": date, "type": 3, "label": NSNull()])
        }
        for labeled in c.dates {
            guard let date = dateString(labeled.value as DateComponents) else { continue }
            if labeled.label == CNLabelDateAnniversary {
                out.append(["date": date, "type": 1, "label": NSNull()])
            } else {
                let label = labeled.label.map { CNLabeledValue<NSDateComponents>.localizedString(forLabel: $0) }
                out.append(["date": date, "type": 0, "label": label.map { $0 as Any } ?? NSNull()])
            }
        }
        return out
    }

    @objc func list(_ call: CAPPluginCall) {
        let keys = nameKeys() + [
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor,
            CNContactDatesKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.sortOrder = .userDefault
        var contacts: [[String: Any]] = []
        do {
            try store.enumerateContacts(with: request) { c, _ in
                let name = self.displayName(c)
                if name.isEmpty { return }
                contacts.append([
                    "key": c.identifier,
                    "name": name,
                    "hasPhone": !c.phoneNumbers.isEmpty,
                    "events": self.events(c),
                ])
            }
            call.resolve(["contacts": contacts])
        } catch {
            call.reject("could not read contacts", nil, error)
        }
    }

    private func methods(_ values: [CNLabeledValue<NSString>]) -> [[String: Any]] {
        values.map { lv in
            let label = lv.label.map { CNLabeledValue<NSString>.localizedString(forLabel: $0) } ?? ""
            return ["value": lv.value as String, "label": label]
        }
    }

    private func phones(_ values: [CNLabeledValue<CNPhoneNumber>]) -> [[String: Any]] {
        values.map { lv in
            let label = lv.label.map { CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: $0) } ?? ""
            return ["value": lv.value.stringValue, "label": label]
        }
    }

    // The contact's thumbnail as a JPEG data URL, or nil when there is none
    // or it will not fit the cap. Read live for the person's header and never
    // stored.
    private func photo(_ c: CNContact) -> Any {
        guard let data = c.thumbnailImageData, let image = UIImage(data: data) else { return NSNull() }
        for quality in [0.8, 0.5] as [CGFloat] {
            if let jpeg = image.jpegData(compressionQuality: quality), jpeg.count <= Self.photoMaxBytes {
                return "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
        }
        return NSNull()
    }

    @objc func read(_ call: CAPPluginCall) {
        let wanted = (call.getArray("keys", String.self) ?? []).filter { !$0.isEmpty }
        let withPhotos = call.getBool("photos") ?? false
        var keys = nameKeys() + [
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor,
            CNContactDatesKey as CNKeyDescriptor,
        ]
        if withPhotos { keys.append(CNContactThumbnailImageDataKey as CNKeyDescriptor) }
        do {
            let found = try store.unifiedContacts(
                matching: CNContact.predicateForContacts(withIdentifiers: wanted),
                keysToFetch: keys
            )
            let byId = Dictionary(found.map { ($0.identifier, $0) }, uniquingKeysWith: { a, _ in a })
            let contacts: [[String: Any]] = wanted.map { key in
                guard let c = byId[key] else { return ["key": key, "found": false] }
                var o: [String: Any] = [
                    "key": key,
                    "found": true,
                    "name": displayName(c),
                    "phones": phones(c.phoneNumbers),
                    "emails": methods(c.emailAddresses),
                    "events": events(c),
                ]
                if withPhotos { o["photo"] = photo(c) }
                return o
            }
            call.resolve(["contacts": contacts])
        } catch {
            call.reject("could not read contacts", nil, error)
        }
    }

    // MARK: Call, Text, Email

    // Opens the dialer, Messages or Mail with the number or address filled
    // in. Nothing is sent without the user.
    @objc func open(_ call: CAPPluginCall) {
        guard let action = call.getString("action"),
              let value = call.getString("value")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            call.reject("missing action or value")
            return
        }
        let url: URL?
        switch action {
        case "call", "text":
            let dialable = value.filter { "0123456789+*#,;".contains($0) }
            url = dialable.isEmpty ? nil : URL(string: (action == "call" ? "tel:" : "sms:") + dialable)
        case "email":
            let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlUserAllowed)
            url = encoded.flatMap { URL(string: "mailto:" + $0) }
        default:
            url = nil
        }
        guard let target = url else {
            call.reject("unsupported action or value")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(target, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("no app to handle \(action)") }
            }
        }
    }
}

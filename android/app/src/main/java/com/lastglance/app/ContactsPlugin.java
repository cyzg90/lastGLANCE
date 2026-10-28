package com.lastglance.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Email;
import android.provider.ContactsContract.CommonDataKinds.Event;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.Contacts;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Read-only access to the phone's address book for People (docs: the People
// spec, Contacts integration and privacy). lastGLANCE never writes to
// contacts. Nothing read here is stored natively; the web side decides what
// the user imports.
//
// A contact is identified by "<lookupKey>/<id>". The lookup key survives
// contact merges and sync re-imports where the row id does not, and
// Contacts.lookupContact resolves a stale id through it. Keys differ on every
// device, so links stay device-local.
//
// Event dates come back raw ("1990-05-17", "--05-17", sometimes "19900517")
// and are parsed on the web side, where the parsing is tested.
//
// Plugin methods run on Capacitor's plugin thread, not the UI thread, so the
// queries here do not block the WebView.
@CapacitorPlugin(
    name = "Contacts",
    permissions = @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
)
public class ContactsPlugin extends Plugin {

    private static final int PHOTO_MAX_BYTES = 64 * 1024;

    @PluginMethod
    public void checkPermission(PluginCall call) {
        resolveState(call);
    }

    // The web side shows its own explanation first (Play's prominent
    // disclosure); this only raises the system prompt.
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            resolveState(call);
            return;
        }
        requestPermissionForAlias("contacts", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        resolveState(call);
    }

    private void resolveState(PluginCall call) {
        PermissionState state = getPermissionState("contacts");
        JSObject ret = new JSObject();
        ret.put("state", state == null ? "prompt" : state.toString());
        call.resolve(ret);
    }

    private boolean granted(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) return true;
        call.reject("Contacts permission not granted", "PERMISSION_DENIED");
        return false;
    }

    // Everyone with a display name, for the import and link lists: name,
    // dated events, and whether a number or address exists. Numbers and
    // addresses themselves are only read by read(), when they are used.
    @PluginMethod
    public void list(PluginCall call) {
        if (!granted(call)) return;
        ContentResolver resolver = getContext().getContentResolver();
        Map<Long, JSArray> events = eventsByContact(resolver, null);
        JSArray out = new JSArray();
        String[] projection = {
            Contacts._ID, Contacts.LOOKUP_KEY, Contacts.DISPLAY_NAME_PRIMARY, Contacts.HAS_PHONE_NUMBER,
        };
        try (Cursor c = resolver.query(Contacts.CONTENT_URI, projection, null, null,
                Contacts.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC")) {
            if (c != null) {
                while (c.moveToNext()) {
                    String name = c.getString(2);
                    if (name == null || name.trim().isEmpty()) continue;
                    long id = c.getLong(0);
                    JSObject o = new JSObject();
                    o.put("key", c.getString(1) + "/" + id);
                    o.put("name", name);
                    o.put("hasPhone", c.getInt(3) > 0);
                    JSArray ev = events.get(id);
                    o.put("events", ev == null ? new JSArray() : ev);
                    out.put(o);
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("contacts", out);
        call.resolve(ret);
    }

    // Live details for linked contacts. A contact that no longer exists comes
    // back with found=false; one whose key moved comes back with its current
    // key so the link can follow it.
    @PluginMethod
    public void read(PluginCall call) {
        if (!granted(call)) return;
        JSArray keys = call.getArray("keys", new JSArray());
        boolean photos = Boolean.TRUE.equals(call.getBoolean("photos", false));
        ContentResolver resolver = getContext().getContentResolver();
        JSArray out = new JSArray();
        List<String> list;
        try {
            list = keys.toList();
        } catch (JSONException e) {
            call.reject("keys must be strings");
            return;
        }
        for (String key : list) {
            JSObject o = new JSObject();
            o.put("key", key);
            Uri contactUri = resolve(resolver, key);
            if (contactUri == null) {
                o.put("found", false);
                out.put(o);
                continue;
            }
            long id = ContentUris.parseId(contactUri);
            String[] projection = { Contacts.LOOKUP_KEY, Contacts.DISPLAY_NAME_PRIMARY };
            try (Cursor c = resolver.query(Contacts.CONTENT_URI, projection, Contacts._ID + "=?",
                    new String[] { String.valueOf(id) }, null)) {
                if (c == null || !c.moveToFirst()) {
                    o.put("found", false);
                    out.put(o);
                    continue;
                }
                o.put("found", true);
                o.put("currentKey", c.getString(0) + "/" + id);
                o.put("name", c.getString(1));
            }
            o.put("phones", phones(resolver, id));
            o.put("emails", emails(resolver, id));
            JSArray ev = eventsByContact(resolver, id).get(id);
            o.put("events", ev == null ? new JSArray() : ev);
            if (photos) o.put("photo", photo(resolver, contactUri));
            out.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("contacts", out);
        call.resolve(ret);
    }

    // Hands off to the dialer, messages or mail app. ACTION_DIAL fills the
    // number without calling, so no CALL_PHONE permission is needed.
    @PluginMethod
    public void open(PluginCall call) {
        String action = call.getString("action", "");
        String value = call.getString("value", "");
        if (value == null || value.isEmpty()) {
            call.reject("value is required");
            return;
        }
        Intent intent;
        switch (action) {
            case "call":
                intent = new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", value, null));
                break;
            case "text":
                intent = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", value, null));
                break;
            case "email":
                intent = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", value, null));
                break;
            default:
                call.reject("unknown action " + action);
                return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app can handle " + action, "NO_APP");
        }
    }

    private static Uri resolve(ContentResolver resolver, String key) {
        int slash = key.lastIndexOf('/');
        if (slash <= 0) return null;
        String lookupKey = key.substring(0, slash);
        long id;
        try {
            id = Long.parseLong(key.substring(slash + 1));
        } catch (NumberFormatException e) {
            id = -1;
        }
        Uri lookupUri = id >= 0
            ? Contacts.getLookupUri(id, lookupKey)
            : Uri.withAppendedPath(Contacts.CONTENT_LOOKUP_URI, lookupKey);
        try {
            return Contacts.lookupContact(resolver, lookupUri);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // All Event rows, or one contact's, grouped by contact id.
    private static Map<Long, JSArray> eventsByContact(ContentResolver resolver, Long contactId) {
        Map<Long, JSArray> map = new HashMap<>();
        String[] projection = {
            ContactsContract.Data.CONTACT_ID, Event.START_DATE, Event.TYPE, Event.LABEL,
        };
        String selection = ContactsContract.Data.MIMETYPE + "=?";
        String[] args = { Event.CONTENT_ITEM_TYPE };
        if (contactId != null) {
            selection += " AND " + ContactsContract.Data.CONTACT_ID + "=?";
            args = new String[] { Event.CONTENT_ITEM_TYPE, String.valueOf(contactId) };
        }
        try (Cursor c = resolver.query(ContactsContract.Data.CONTENT_URI, projection, selection, args, null)) {
            if (c == null) return map;
            while (c.moveToNext()) {
                String date = c.getString(1);
                if (date == null || date.isEmpty()) continue;
                JSObject e = new JSObject();
                e.put("date", date);
                e.put("type", c.getInt(2));
                e.put("label", c.getString(3));
                long id = c.getLong(0);
                JSArray list = map.get(id);
                if (list == null) {
                    list = new JSArray();
                    map.put(id, list);
                }
                list.put(e);
            }
        }
        return map;
    }

    private JSArray phones(ContentResolver resolver, long id) {
        JSArray out = new JSArray();
        String[] projection = { Phone.NUMBER, Phone.TYPE, Phone.LABEL };
        try (Cursor c = resolver.query(Phone.CONTENT_URI, projection, Phone.CONTACT_ID + "=?",
                new String[] { String.valueOf(id) }, Phone.IS_SUPER_PRIMARY + " DESC")) {
            if (c == null) return out;
            while (c.moveToNext()) {
                JSObject p = new JSObject();
                p.put("value", c.getString(0));
                p.put("label", Phone.getTypeLabel(getContext().getResources(), c.getInt(1), c.getString(2)).toString());
                out.put(p);
            }
        }
        return out;
    }

    private JSArray emails(ContentResolver resolver, long id) {
        JSArray out = new JSArray();
        String[] projection = { Email.ADDRESS, Email.TYPE, Email.LABEL };
        try (Cursor c = resolver.query(Email.CONTENT_URI, projection, Email.CONTACT_ID + "=?",
                new String[] { String.valueOf(id) }, Email.IS_SUPER_PRIMARY + " DESC")) {
            if (c == null) return out;
            while (c.moveToNext()) {
                JSObject p = new JSObject();
                p.put("value", c.getString(0));
                p.put("label", Email.getTypeLabel(getContext().getResources(), c.getInt(1), c.getString(2)).toString());
                out.put(p);
            }
        }
        return out;
    }

    // The contact's thumbnail as a data URL, read live and never stored.
    private static String photo(ContentResolver resolver, Uri contactUri) {
        try (InputStream in = Contacts.openContactPhotoInputStream(resolver, contactUri, false)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > PHOTO_MAX_BYTES) return null;
            }
            return "data:image/jpeg;base64," + Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
        } catch (IOException e) {
            return null;
        }
    }
}

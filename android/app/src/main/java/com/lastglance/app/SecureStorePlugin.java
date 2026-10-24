package com.lastglance.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Keystore-backed secret storage for sync/vault/intents credentials (issue
// #210). Values are AES-GCM ciphertext in a private SharedPreferences file;
// the AES key lives in the Android Keystore (non-exportable, hardware-backed
// where the device supports it), so the ciphertext is useless off-device.
// That failure mode is deliberate: prefs restored or transferred to another
// device won't decrypt, get() reports the entry as absent, and the app asks
// the user to re-enter credentials rather than failing cryptically.
//
// Registered in MainActivity; consumed by src/native/secureStore.ts, which
// falls back to localStorage on non-Android platforms. The storage itself is
// SecureStore, which the headless refresh's bridge reads too.
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("value", SecureStore.get(getContext(), key));
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("missing key or value");
            return;
        }
        if (!SecureStore.set(getContext(), key, value)) {
            call.reject("encrypt failed");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        SecureStore.delete(getContext(), key);
        call.resolve();
    }
}

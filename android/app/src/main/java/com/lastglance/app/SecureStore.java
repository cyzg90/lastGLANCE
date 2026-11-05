package com.lastglance.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The Keystore-backed secret store behind SecureStorePlugin (issue #210), on a
// Context alone so the launcher's headless refresh (launcher/HeadlessBridge.kt),
// which has no Capacitor bridge, reads the same entries. Values are AES-GCM
// ciphertext in a private SharedPreferences file; the AES key lives in the
// Android Keystore, so the ciphertext is useless off-device and an entry that
// cannot be decrypted reads as absent.
public final class SecureStore {

    private static final String PREFS = "lastglance_secure_store";
    private static final String KEY_ALIAS = "lastglance_secure_store";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    // GCM with the Keystore-generated IV, 128-bit tag. Stored value format is
    // "v1:" + base64(iv) + ":" + base64(ciphertext).
    private static final int GCM_TAG_BITS = 128;
    private static final String FORMAT_PREFIX = "v1:";

    private SecureStore() {}

    // The stored value, or null when absent or undecryptable.
    public static String get(Context context, String key) {
        String stored = prefs(context).getString(key, null);
        if (stored == null) return null;
        String plain = decrypt(stored);
        if (plain == null) {
            // Undecryptable (restored ciphertext, invalidated key). The Keystore
            // key is non-exportable, so this can never recover — drop the entry
            // so the caller sees a clean "absent" and a later set() starts fresh.
            prefs(context).edit().remove(key).apply();
        }
        return plain;
    }

    // False when the value could not be encrypted.
    public static boolean set(Context context, String key, String value) {
        String stored = encrypt(value);
        if (stored == null) {
            // One retry with a fresh key covers the rare corrupted-alias state
            // (e.g. a partially restored Keystore). Existing entries were already
            // undecryptable in that state, so rotating the key loses nothing.
            deleteKeyQuietly();
            stored = encrypt(value);
        }
        if (stored == null) return false;
        prefs(context).edit().putString(key, stored).apply();
        return true;
    }

    public static void delete(Context context, String key) {
        prefs(context).edit().remove(key).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Keystore-backed AES-GCM ───────────────────────────────────────────────

    private static String encrypt(String plaintext) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // The Keystore must generate the IV: keys are created with
            // randomized encryption required (the secure default), and passing
            // a caller-provided IV at encrypt time throws
            // InvalidAlgorithmParameterException ("Caller-provided IV not
            // permitted") — which made every set() fail and presented as wiped
            // sync settings in the 2.1.0 release candidate.
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(plaintext.getBytes("UTF-8"));
            return FORMAT_PREFIX
                + Base64.encodeToString(iv, Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private static String decrypt(String stored) {
        try {
            if (!stored.startsWith(FORMAT_PREFIX)) return null;
            String[] parts = stored.substring(FORMAT_PREFIX.length()).split(":", 2);
            if (parts.length != 2) return null;
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(ct), "UTF-8");
        } catch (Exception e) {
            // Bad tag / invalidated or missing key / malformed entry — all map to
            // "absent" (see get()).
            return null;
        }
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // No user-auth binding: these credentials are read at boot for
            // background-capable sync, before any biometric prompt could show.
            .build());
        return kg.generateKey();
    }

    private static void deleteKeyQuietly() {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
        }
    }
}

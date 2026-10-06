package com.noth2.mangamanager;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// NAS connections (WebDAV / SMB). The connection list and the passwords live in
// EncryptedSharedPreferences (key in the Android keystore) — never in the JS
// settings file. JS only ever sees the connections without passwords.
final class NasStore {
    static final class Conn {
        String id, name, type, url, host, share, domain, user;
        int port;
        boolean insecure; // WebDAV over https with a self-signed certificate

        JSONObject toJson(boolean withSecretFlag, String password) throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("name", name);
            o.put("type", type);
            o.put("url", url == null ? "" : url);
            o.put("host", host == null ? "" : host);
            o.put("port", port);
            o.put("share", share == null ? "" : share);
            o.put("domain", domain == null ? "" : domain);
            o.put("user", user == null ? "" : user);
            o.put("insecure", insecure);
            if (withSecretFlag) o.put("hasPassword", password != null && !password.isEmpty());
            return o;
        }

        static Conn fromJson(JSONObject o) {
            Conn c = new Conn();
            c.id = o.optString("id");
            c.name = o.optString("name");
            c.type = o.optString("type", "webdav");
            c.url = o.optString("url");
            c.host = o.optString("host");
            c.port = o.optInt("port", 0);
            c.share = o.optString("share");
            c.domain = o.optString("domain");
            c.user = o.optString("user");
            c.insecure = o.optBoolean("insecure", false);
            return c;
        }
    }

    private static SharedPreferences prefs;

    static synchronized void init(Context ctx) {
        if (prefs != null) return;
        try {
            MasterKey key = new MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            prefs = EncryptedSharedPreferences.create(ctx, "nas", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            throw new RuntimeException("NAS store unavailable: " + e.getMessage(), e);
        }
    }

    static synchronized List<Conn> list() {
        List<Conn> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs.getString("conns", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(Conn.fromJson(a.getJSONObject(i)));
        } catch (JSONException ignored) {
        }
        return out;
    }

    static synchronized Conn get(String id) {
        for (Conn c : list()) if (c.id.equals(id)) return c;
        return null;
    }

    static synchronized String password(String id) {
        return prefs.getString("pw." + id, "");
    }

    // Insert or replace; password == null keeps the stored one.
    static synchronized void save(Conn c, String password) throws JSONException {
        JSONArray a = new JSONArray();
        boolean found = false;
        for (Conn x : list()) {
            if (x.id.equals(c.id)) {
                a.put(c.toJson(false, null));
                found = true;
            } else a.put(x.toJson(false, null));
        }
        if (!found) a.put(c.toJson(false, null));
        SharedPreferences.Editor e = prefs.edit().putString("conns", a.toString());
        if (password != null) e.putString("pw." + c.id, password);
        e.apply();
    }

    static synchronized void remove(String id) throws JSONException {
        JSONArray a = new JSONArray();
        for (Conn x : list()) if (!x.id.equals(id)) a.put(x.toJson(false, null));
        prefs.edit().putString("conns", a.toString()).remove("pw." + id).apply();
    }
}

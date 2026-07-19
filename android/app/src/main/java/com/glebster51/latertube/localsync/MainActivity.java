package com.glebster51.latertube.localsync;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final String PREFS = "latertube_local_sync";
    private static final String VIDEOS = "videos";
    private static final String PENDING_DELETED = "pendingDeleted";
    private static final String PENDING_WATCHED = "pendingWatched";
    private static final String DEVICE_ID = "deviceId";
    private static final String REQUEST_FILE = "sync-request.json";
    private static final String RESPONSE_FILE = "sync-response.json";
    private final Object lock = new Object();
    private SharedPreferences prefs;
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        ensureDeviceId();
        processSyncRequest();
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        webView.addJavascriptInterface(new PhoneBridge(), "Android");
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        processSyncRequest();
        if (webView != null) webView.reload();
    }

    private void ensureDeviceId() {
        if (!prefs.contains(DEVICE_ID)) prefs.edit().putString(DEVICE_ID, UUID.randomUUID().toString()).apply();
    }

    private JSONArray videos() {
        try { return new JSONArray(prefs.getString(VIDEOS, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private JSONArray pending(String key) {
        try { return new JSONArray(prefs.getString(key, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private void saveVideos(JSONArray value) { prefs.edit().putString(VIDEOS, value.toString()).apply(); }
    private void savePending(String key, JSONArray value) { prefs.edit().putString(key, value.toString()).apply(); }

    private void processSyncRequest() {
        synchronized (lock) {
            File requestFile = new File(getFilesDir(), REQUEST_FILE);
            if (!requestFile.isFile()) return;
            try {
                JSONObject request = new JSONObject(new String(Files.readAllBytes(requestFile.toPath()), StandardCharsets.UTF_8));
                String action = request.optString("action");
                if ("sync".equals(action)) {
                    JSONArray incoming = request.optJSONArray("videos");
                    JSONObject response = new JSONObject();
                    response.put("ok", true);
                    response.put("deviceId", prefs.getString(DEVICE_ID, ""));
                    response.put("deletedVideoIds", pending(PENDING_DELETED));
                    response.put("watchedVideoIds", pending(PENDING_WATCHED));
                    response.put("revision", System.currentTimeMillis());
                    writeResponse(response);
                } else if ("ack".equals(action)) {
                    applyAcknowledgement(request);
                    JSONObject response = new JSONObject();
                    response.put("ok", true);
                    writeResponse(response);
                } else {
                    throw new IllegalArgumentException("Unknown sync action");
                }
            } catch (Exception error) {
                try { writeResponse(new JSONObject().put("ok", false).put("error", error.getMessage())); }
                catch (Exception ignored) { }
            } finally {
                requestFile.delete();
            }
        }
    }

    private void applyAcknowledgement(JSONObject request) throws Exception {
        JSONArray incoming = request.optJSONArray("videos");
        if (incoming == null) incoming = new JSONArray();
        Set<String> watched = toSet(pending(PENDING_WATCHED));
        JSONArray oldVideos = videos();
        for (int i = 0; i < oldVideos.length(); i++) {
            JSONObject old = oldVideos.optJSONObject(i);
            if (old != null && old.optBoolean("watched")) watched.add(old.optString("id"));
        }
        JSONArray merged = new JSONArray();
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject video = incoming.optJSONObject(i);
            if (video == null || video.optString("id").isEmpty()) continue;
            JSONObject copy = new JSONObject(video.toString());
            copy.put("watched", watched.contains(copy.optString("id")));
            merged.put(copy);
        }
        saveVideos(merged);
        savePending(PENDING_DELETED, new JSONArray());
        savePending(PENDING_WATCHED, new JSONArray());
    }

    private void writeResponse(JSONObject response) throws Exception {
        Files.write(new File(getFilesDir(), RESPONSE_FILE).toPath(), response.toString().getBytes(StandardCharsets.UTF_8));
    }

    private Set<String> toSet(JSONArray array) {
        Set<String> values = new HashSet<>();
        for (int i = 0; i < array.length(); i++) values.add(array.optString(i));
        return values;
    }

    private void toggleWatched(String id) {
        synchronized (lock) {
            JSONArray current = videos();
            JSONArray changed = new JSONArray();
            boolean nowWatched = false;
            for (int i = 0; i < current.length(); i++) {
                JSONObject video = current.optJSONObject(i);
                if (video == null) continue;
                if (id.equals(video.optString("id"))) {
                    nowWatched = !video.optBoolean("watched");
                    try { video.put("watched", nowWatched); } catch (Exception ignored) { }
                }
                changed.put(video);
            }
            saveVideos(changed);
            Set<String> dirty = toSet(pending(PENDING_WATCHED));
            if (nowWatched) dirty.add(id); else dirty.remove(id);
            savePending(PENDING_WATCHED, new JSONArray(dirty));
        }
    }

    private void deleteVideo(String id) {
        synchronized (lock) {
            JSONArray current = videos();
            JSONArray changed = new JSONArray();
            for (int i = 0; i < current.length(); i++) {
                JSONObject video = current.optJSONObject(i);
                if (video != null && !id.equals(video.optString("id"))) changed.put(video);
            }
            saveVideos(changed);
            Set<String> deleted = toSet(pending(PENDING_DELETED));
            deleted.add(id);
            savePending(PENDING_DELETED, new JSONArray(deleted));
        }
    }

    private final class PhoneBridge {
        @JavascriptInterface public String getVideos() { synchronized (lock) { return videos().toString(); } }
        @JavascriptInterface public void toggleWatched(String id) { MainActivity.this.toggleWatched(id); }
        @JavascriptInterface public void deleteVideo(String id) { MainActivity.this.deleteVideo(id); }
        @JavascriptInterface public void openVideo(String url) {
            try {
                Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(Intent.createChooser(view, "Открыть видео"));
            } catch (Exception ignored) { }
        }
    }
}

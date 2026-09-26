package com.glebster51.latertube.localsync;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    private static final String PREFS = "latertube_local_sync";
    private static final String SORT = "sort";
    private static final String REMOVE_ON_OPEN = "removeOnOpen";
    private static final String FIREBASE_CREDENTIAL = "firebaseCredential";
    private static final String STATE_CACHE_FILE = "firebase-state-cache.json";
    private static final String KEY_ALIAS = "LaterTubeFirebaseCredential";
    private static final int MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private FirebaseRepository repository;
    private WebView webView;
    private boolean pageReady;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        removeLegacyLocalLists();
        repository = new FirebaseRepository(BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_DATABASE_URL,
                new EncryptedCredentialStore());
        webView = new WebView(this);
        getWindow().setStatusBarColor(Color.rgb(24, 24, 24));
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        webView.addJavascriptInterface(new PhoneBridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (repository.hasCredential()) {
                    JSONObject cached = readStateCache();
                    if (cached != null) sendCachedState(cached);
                    loadCloudState();
                }
                else sendError("AUTH_REQUIRED", "Sign in to continue");
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private void removeLegacyLocalLists() {
        prefs.edit()
                .remove("videos")
                .remove("pendingDeleted")
                .remove("pendingWatched")
                .remove("deviceId")
                .apply();
    }

    private void loadCloudState() {
        executor.execute(() -> {
            try {
                JSONObject cached = readStateCache();
                long cachedUpdatedAt = cached == null ? 0 : cached.optLong("updatedAt", 0);
                FirebaseRepository.State state = repository.loadIfChanged(cachedUpdatedAt);
                if (state == null) sendCloudNotModified();
                else sendState(state);
            }
            catch (Exception error) { handleCloudError(error); }
        });
    }

    private void authenticate(String email, String password, boolean createAccount) {
        executor.execute(() -> {
            try { sendState(repository.authenticate(email, password, createAccount)); }
            catch (Exception error) { handleCloudError(error); }
        });
    }

    private void requestPasswordReset(String email) {
        executor.execute(() -> {
            try {
                repository.requestPasswordReset(email);
                evaluate("window.LaterTube && window.LaterTube.receivePasswordResetSent("
                        + JSONObject.quote(email) + ")");
            } catch (Exception error) { handleCloudError(error); }
        });
    }

    private void archiveVideo(String id, boolean openAfter, String url) {
        executor.execute(() -> {
            try {
                FirebaseRepository.State state = repository.archive(id);
                sendState(state);
                if (openAfter) openExternalVideo(url);
            } catch (Exception error) { handleCloudError(error); }
        });
    }

    private void restoreVideo(String id) {
        executor.execute(() -> {
            try { sendState(repository.restore(id)); }
            catch (Exception error) { handleCloudError(error); }
        });
    }

    private void requestDeleteHistoryVideo(String id, String title) {
        runOnUiThread(() -> new AlertDialog.Builder(this)
                .setTitle("Удалить навсегда?")
                .setMessage("«" + title + "» будет полностью удалено из раздела «Просмотрено». Отменить это действие нельзя.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (dialog, which) -> deleteHistoryVideo(id))
                .show());
    }

    private void deleteHistoryVideo(String id) {
        evaluate("window.LaterTube && window.LaterTube.receiveDeleteStarted()");
        executor.execute(() -> {
            try { sendState(repository.deleteHistory(id)); }
            catch (Exception error) { handleCloudError(error); }
        });
    }

    private void handleCloudError(Exception error) {
        if (error instanceof FirebaseRepository.CloudException) {
            FirebaseRepository.CloudException cloudError = (FirebaseRepository.CloudException) error;
            sendError(cloudError.code, cloudError.getMessage());
        } else sendError("CLOUD_FAILED", error.getMessage());
    }

    private void sendState(FirebaseRepository.State state) {
        try {
            JSONObject response = state.toJson()
                    .put("email", repository.credentialEmail())
                    .put("uid", repository.credentialUid());
            saveStateCache(response);
            evaluate("window.LaterTube && window.LaterTube.receiveState("
                    + JSONObject.quote(response.toString()) + ",false)");
        } catch (Exception error) { sendError("INVALID_CLOUD_DATA", error.getMessage()); }
    }

    private void sendCachedState(JSONObject cached) {
        evaluate("window.LaterTube && window.LaterTube.receiveState("
                + JSONObject.quote(cached.toString()) + ",true)");
    }

    private void sendCloudNotModified() {
        evaluate("window.LaterTube && window.LaterTube.receiveCloudNotModified()");
    }

    private File stateCacheFile() { return new File(getFilesDir(), STATE_CACHE_FILE); }

    private JSONObject readStateCache() {
        File file = stateCacheFile();
        if (!file.isFile()) return null;
        try {
            JSONObject cached = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            if (!repository.credentialUid().equals(cached.optString("uid"))) return null;
            if (cached.optJSONArray("active") == null || cached.optJSONArray("history") == null) return null;
            return cached;
        } catch (Exception ignored) { return null; }
    }

    private void saveStateCache(JSONObject state) {
        File file = stateCacheFile();
        File temporary = new File(getFilesDir(), STATE_CACHE_FILE + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(state.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
            if (file.isFile() && !file.delete()) throw new Exception("Could not replace state cache");
            if (!temporary.renameTo(file)) throw new Exception("Could not save state cache");
        } catch (Exception ignored) {
            if (temporary.isFile()) temporary.delete();
        }
    }

    private void clearStateCache() {
        File file = stateCacheFile();
        if (file.isFile()) file.delete();
    }

    private void sendError(String code, String message) {
        evaluate("window.LaterTube && window.LaterTube.receiveError("
                + JSONObject.quote(code == null ? "CLOUD_FAILED" : code) + ","
                + JSONObject.quote(message == null ? "" : message) + ")");
    }

    private void evaluate(String script) {
        runOnUiThread(() -> {
            if (webView != null && pageReady) webView.evaluateJavascript(script, null);
        });
    }

    private void openExternalVideo(String url) {
        runOnUiThread(() -> {
            try {
                Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                view.setPackage("app.revanced.android.youtube");
                startActivity(view);
            } catch (Exception ignored) {
                try {
                    Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(Intent.createChooser(fallback, "Открыть видео"));
                } catch (Exception ignoredAgain) { }
            }
        });
    }

    private File thumbnailFile(String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{6,20}")) return null;
        File directory = new File(getFilesDir(), "thumbnails");
        if (!directory.isDirectory()) directory.mkdirs();
        return new File(directory, id + ".jpg");
    }

    private String thumbnailData(String id) {
        File file = thumbnailFile(id);
        if (file == null || !file.isFile()) return "";
        try { return Base64.encodeToString(Files.readAllBytes(file.toPath()), Base64.NO_WRAP); }
        catch (Exception ignored) { return ""; }
    }

    private void cacheThumbnail(String id, String rawUrl) {
        executor.execute(() -> {
            File file = thumbnailFile(id);
            if (file == null || file.isFile() || rawUrl == null || !rawUrl.startsWith("https://")) return;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(rawUrl).openConnection();
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(15_000);
                connection.setInstanceFollowRedirects(true);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) return;
                int announcedLength = connection.getContentLength();
                if (announcedLength > MAX_THUMBNAIL_BYTES) return;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        if (output.size() + read > MAX_THUMBNAIL_BYTES) return;
                        output.write(buffer, 0, read);
                    }
                }
                try (FileOutputStream target = new FileOutputStream(file)) { output.writeTo(target); }
            } catch (Exception ignored) { }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    private SecretKey credentialKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private String encryptCredential(String plainText) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, credentialKey());
        String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String data = Base64.encodeToString(cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        return iv + ":" + data;
    }

    private String decryptCredential(String encrypted) throws Exception {
        String[] parts = encrypted.split(":", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid encrypted credential");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, credentialKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private final class EncryptedCredentialStore implements FirebaseRepository.CredentialStore {
        @Override public FirebaseRepository.Credential load() {
            String encrypted = prefs.getString(FIREBASE_CREDENTIAL, "");
            if (encrypted.isEmpty()) return null;
            try {
                JSONObject value = new JSONObject(decryptCredential(encrypted));
                return new FirebaseRepository.Credential(value.optString("refreshToken"),
                        value.optString("uid"), value.optString("email"));
            } catch (Exception error) {
                clear();
                return null;
            }
        }

        @Override public void save(FirebaseRepository.Credential credential) {
            try {
                JSONObject value = new JSONObject()
                        .put("refreshToken", credential.refreshToken)
                        .put("uid", credential.uid)
                        .put("email", credential.email);
                prefs.edit().putString(FIREBASE_CREDENTIAL, encryptCredential(value.toString())).apply();
            } catch (Exception error) { clear(); }
        }

        @Override public void clear() { prefs.edit().remove(FIREBASE_CREDENTIAL).apply(); }
    }

    private final class PhoneBridge {
        @JavascriptInterface public String getSort() { return prefs.getString(SORT, "added-newest"); }
        @JavascriptInterface public void setSort(String value) { prefs.edit().putString(SORT, value).apply(); }
        @JavascriptInterface public boolean getRemoveOnOpen() { return prefs.getBoolean(REMOVE_ON_OPEN, false); }
        @JavascriptInterface public void setRemoveOnOpen(boolean enabled) { prefs.edit().putBoolean(REMOVE_ON_OPEN, enabled).apply(); }
        @JavascriptInterface public String getThumbnailData(String id) { return thumbnailData(id); }
        @JavascriptInterface public void cacheThumbnail(String id, String url) { MainActivity.this.cacheThumbnail(id, url); }
        @JavascriptInterface public boolean hasCredential() { return repository.hasCredential(); }
        @JavascriptInterface public void authenticate(String email, String password, boolean createAccount) {
            MainActivity.this.authenticate(email, password, createAccount);
        }
        @JavascriptInterface public void requestPasswordReset(String email) {
            MainActivity.this.requestPasswordReset(email);
        }
        @JavascriptInterface public void refresh() { loadCloudState(); }
        @JavascriptInterface public void signOut() {
            repository.signOut();
            clearStateCache();
            sendError("AUTH_REQUIRED", "Signed out");
        }
        @JavascriptInterface public void archiveVideo(String id) { MainActivity.this.archiveVideo(id, false, null); }
        @JavascriptInterface public void restoreVideo(String id) { MainActivity.this.restoreVideo(id); }
        @JavascriptInterface public void deleteHistoryVideo(String id, String title) {
            MainActivity.this.requestDeleteHistoryVideo(id, title);
        }
        @JavascriptInterface public void openVideo(String id, String url, boolean moveToHistory) {
            if (moveToHistory) MainActivity.this.archiveVideo(id, true, url);
            else openExternalVideo(url);
        }
    }
}

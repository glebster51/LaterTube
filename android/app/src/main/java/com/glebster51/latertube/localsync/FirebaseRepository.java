package com.glebster51.latertube.localsync;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

final class FirebaseRepository {
    private static final String IDENTITY_API = "https://identitytoolkit.googleapis.com/v1";
    private static final String TOKEN_API = "https://securetoken.googleapis.com/v1/token";
    private static final int MAX_RETRIES = 3;
    private static final String DOCUMENT_FORMAT = "LaterTube cloud list";

    interface CredentialStore {
        Credential load();
        void save(Credential credential);
        void clear();
    }

    static final class Credential {
        final String refreshToken;
        final String uid;
        final String email;

        Credential(String refreshToken, String uid, String email) {
            this.refreshToken = refreshToken;
            this.uid = uid;
            this.email = email;
        }
    }

    static final class CloudException extends Exception {
        final String code;
        final int status;

        CloudException(String code, String message) { this(code, message, 0); }
        CloudException(String code, String message, int status) {
            super(message);
            this.code = code;
            this.status = status;
        }
    }

    static final class State {
        final JSONArray active;
        final JSONArray history;
        final long updatedAt;

        State(JSONArray active, JSONArray history) {
            this(active, history, 0);
        }

        State(JSONArray active, JSONArray history, long updatedAt) {
            this.active = active;
            this.history = history;
            this.updatedAt = updatedAt;
        }

        JSONObject toJson() throws Exception {
            return new JSONObject().put("active", active).put("history", history).put("updatedAt", updatedAt);
        }
    }

    private static final class Session {
        String idToken;
        String refreshToken;
        String uid;
        String email;
        long expiresAt;
    }

    private static final class Snapshot {
        State state;
        String etag;
    }

    private static final class Response {
        int status;
        String body;
        String etag;
    }

    private final String apiKey;
    private final String databaseUrl;
    private final CredentialStore credentialStore;
    private Session currentSession;

    FirebaseRepository(String apiKey, String databaseUrl, CredentialStore credentialStore) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.databaseUrl = databaseUrl == null ? "" : databaseUrl.trim().replaceAll("/$", "");
        this.credentialStore = credentialStore;
    }

    boolean hasCredential() {
        Credential value = credentialStore.load();
        return value != null && !value.refreshToken.isEmpty() && !value.uid.isEmpty();
    }

    String credentialEmail() {
        Credential value = credentialStore.load();
        return value == null ? "" : value.email;
    }

    String credentialUid() {
        Credential value = credentialStore.load();
        return value == null ? "" : value.uid;
    }

    void signOut() {
        currentSession = null;
        credentialStore.clear();
    }

    State authenticate(String email, String password, boolean createAccount) throws Exception {
        requireConfig();
        String endpoint = createAccount ? "accounts:signUp" : "accounts:signInWithPassword";
        JSONObject request = new JSONObject()
                .put("email", email)
                .put("password", password)
                .put("returnSecureToken", true);
        Response response = request("POST", IDENTITY_API + "/" + endpoint + "?key=" + encode(apiKey),
                "application/json", request.toString(), null);
        JSONObject payload = parseObject(response.body);
        if (response.status < 200 || response.status >= 300) throw authError(payload, response.status);
        acceptSession(payload, email);
        return load();
    }

    void requestPasswordReset(String email) throws Exception {
        requireConfig();
        JSONObject request = new JSONObject()
                .put("requestType", "PASSWORD_RESET")
                .put("email", email);
        Response response = request("POST", IDENTITY_API + "/accounts:sendOobCode?key=" + encode(apiKey),
                "application/json", request.toString(), null);
        JSONObject payload = parseObject(response.body);
        if (response.status >= 200 && response.status < 300) return;
        CloudException error = authError(payload, response.status);
        if (!"INVALID_CREDENTIALS".equals(error.code)) throw error;
    }

    State load() throws Exception { return readSnapshot(false).state; }

    State loadIfChanged(long cachedUpdatedAt) throws Exception {
        if (cachedUpdatedAt <= 0) return load();
        long cloudUpdatedAt = readCloudVersion(false);
        if (cloudUpdatedAt > 0 && cloudUpdatedAt == cachedUpdatedAt) return null;
        return load();
    }

    State archive(String id) throws Exception {
        final long now = System.currentTimeMillis();
        final String changeId = UUID.randomUUID().toString();
        CloudException lastConflict = null;
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                Snapshot snapshot = readSnapshot(false);
                JSONArray active = cloneArray(snapshot.state.active);
                JSONArray history = cloneArray(snapshot.state.history);
                JSONObject video = findById(active, id);
                if (video != null) {
                    JSONObject archived = new JSONObject(video.toString());
                    archived.put("removedAt", now);
                    archived.put("updatedAt", now);
                    archived.put("changeId", changeId);
                    upsert(history, archived, true, now);
                    removeById(active, id);
                }
                State next = new State(active, history, now);
                writeState(snapshot, next, now, false);
                return next;
            } catch (CloudException error) {
                if (!"CLOUD_CONFLICT".equals(error.code) || attempt == MAX_RETRIES - 1) throw error;
                lastConflict = error;
            }
        }
        throw lastConflict;
    }

    State restore(String id) throws Exception {
        final long now = System.currentTimeMillis();
        final String changeId = UUID.randomUUID().toString();
        CloudException lastConflict = null;
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                Snapshot snapshot = readSnapshot(false);
                JSONArray active = cloneArray(snapshot.state.active);
                JSONArray history = cloneArray(snapshot.state.history);
                JSONObject video = findById(history, id);
                if (video != null) {
                    JSONObject restored = new JSONObject(video.toString());
                    restored.remove("removedAt");
                    restored.put("addedAt", now);
                    restored.put("updatedAt", now);
                    restored.put("changeId", changeId);
                    upsert(active, restored, false, now);
                    removeById(history, id);
                }
                State next = new State(active, history, now);
                writeState(snapshot, next, now, false);
                return next;
            } catch (CloudException error) {
                if (!"CLOUD_CONFLICT".equals(error.code) || attempt == MAX_RETRIES - 1) throw error;
                lastConflict = error;
            }
        }
        throw lastConflict;
    }

    State deleteHistory(String id) throws Exception {
        final long now = System.currentTimeMillis();
        CloudException lastConflict = null;
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                Snapshot snapshot = readSnapshot(false);
                JSONArray history = cloneArray(snapshot.state.history);
                removeById(history, id);
                State next = new State(cloneArray(snapshot.state.active), history, now);
                writeState(snapshot, next, now, false);
                return next;
            } catch (CloudException error) {
                if (!"CLOUD_CONFLICT".equals(error.code) || attempt == MAX_RETRIES - 1) throw error;
                lastConflict = error;
            }
        }
        throw lastConflict;
    }

    private void requireConfig() throws CloudException {
        if (apiKey.isEmpty() || databaseUrl.isEmpty()) {
            throw new CloudException("FIREBASE_NOT_CONFIGURED", "Firebase is not configured for this build");
        }
    }

    private Session session(boolean forceRefresh) throws Exception {
        requireConfig();
        if (!forceRefresh && currentSession != null && currentSession.expiresAt - System.currentTimeMillis() > 60_000) {
            return currentSession;
        }
        Credential stored = credentialStore.load();
        if (stored == null || stored.refreshToken.isEmpty()) throw new CloudException("AUTH_REQUIRED", "Sign in to continue");
        String body = "grant_type=refresh_token&refresh_token=" + encode(stored.refreshToken);
        Response response = request("POST", TOKEN_API + "?key=" + encode(apiKey),
                "application/x-www-form-urlencoded", body, null);
        JSONObject payload = parseObject(response.body);
        if (response.status < 200 || response.status >= 300) {
            signOut();
            throw authError(payload, response.status);
        }
        acceptSession(payload, stored.email);
        return currentSession;
    }

    private void acceptSession(JSONObject payload, String email) throws Exception {
        Session next = new Session();
        next.idToken = nonEmpty(payload.optString("idToken"), payload.optString("id_token"));
        next.refreshToken = nonEmpty(payload.optString("refreshToken"), payload.optString("refresh_token"));
        next.uid = nonEmpty(payload.optString("localId"), payload.optString("user_id"));
        next.email = nonEmpty(payload.optString("email"), email == null ? "" : email);
        long expiresIn = positiveLong(nonEmpty(payload.optString("expiresIn"), payload.optString("expires_in")), 3600);
        next.expiresAt = System.currentTimeMillis() + Math.max(60, expiresIn) * 1000;
        if (next.idToken.isEmpty() || next.refreshToken.isEmpty() || next.uid.isEmpty()) {
            throw new CloudException("AUTH_FAILED", "Firebase did not return a complete session");
        }
        currentSession = next;
        credentialStore.save(new Credential(next.refreshToken, next.uid, next.email));
    }

    private Snapshot readSnapshot(boolean retriedAuth) throws Exception {
        Session auth = session(false);
        String url = userUrl(auth);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Firebase-ETag", "true");
        Response response = request("GET", url, null, null, headers);
        if ((response.status == 401 || response.status == 403) && !retriedAuth) {
            session(true);
            return readSnapshot(true);
        }
        ensureDatabaseSuccess(response);
        JSONObject root = "null".equals(response.body.trim()) || response.body.trim().isEmpty()
                ? new JSONObject() : parseObject(response.body);
        JSONObject fallback = document(new JSONArray(), System.currentTimeMillis());
        State normalized = reconcile(root.optJSONObject("active") == null ? fallback : root.optJSONObject("active"),
                root.optJSONObject("history") == null ? fallback : root.optJSONObject("history"));
        Snapshot snapshot = new Snapshot();
        snapshot.state = new State(normalized.active, normalized.history, root.optLong("updatedAt", 0));
        snapshot.etag = response.etag;
        return snapshot;
    }

    private long readCloudVersion(boolean retriedAuth) throws Exception {
        Session auth = session(false);
        Response response = request("GET", userPathUrl(auth, "updatedAt"), null, null, null);
        if ((response.status == 401 || response.status == 403) && !retriedAuth) {
            session(true);
            return readCloudVersion(true);
        }
        ensureDatabaseSuccess(response);
        String value = response.body == null ? "" : response.body.trim();
        if (value.isEmpty() || "null".equals(value)) return 0;
        try { return Long.parseLong(value); }
        catch (Exception error) { throw new CloudException("INVALID_CLOUD_DATA", "Firebase returned invalid state version"); }
    }

    private void writeState(Snapshot snapshot, State state, long updatedAt, boolean retriedAuth) throws Exception {
        JSONObject root = new JSONObject()
                .put("format", "LaterTube Firebase state")
                .put("schemaVersion", 1)
                .put("updatedAt", updatedAt)
                .put("active", document(state.active, updatedAt))
                .put("history", document(state.history, updatedAt));
        Session auth = session(false);
        Map<String, String> headers = new LinkedHashMap<>();
        if (snapshot.etag != null && !snapshot.etag.isEmpty()) headers.put("If-Match", snapshot.etag);
        Response response = request("PUT", userUrl(auth), "application/json; charset=utf-8", root.toString(), headers);
        if (response.status == 412) throw new CloudException("CLOUD_CONFLICT", "Firebase state changed on another device", 412);
        if ((response.status == 401 || response.status == 403) && !retriedAuth) {
            session(true);
            writeState(snapshot, state, updatedAt, true);
            return;
        }
        ensureDatabaseSuccess(response);
    }

    private String userUrl(Session session) throws Exception {
        return userPathUrl(session, "");
    }

    private String userPathUrl(Session session, String path) throws Exception {
        String suffix = path == null || path.isEmpty() ? "" : "/" + encode(path);
        return databaseUrl + "/users/" + encode(session.uid) + suffix + ".json?auth=" + encode(session.idToken);
    }

    private void ensureDatabaseSuccess(Response response) throws CloudException {
        if (response.status >= 200 && response.status < 300) return;
        String code = response.status == 401 || response.status == 403 ? "AUTH_REQUIRED"
                : response.status == 404 ? "FIREBASE_DATABASE_MISSING" : "CLOUD_REQUEST_FAILED";
        throw new CloudException(code, response.body.isEmpty() ? "Firebase request failed" : response.body, response.status);
    }

    private CloudException authError(JSONObject payload, int status) {
        String raw = payload.optJSONObject("error") == null
                ? "Firebase authentication failed"
                : payload.optJSONObject("error").optString("message", "Firebase authentication failed");
        String key = raw.split(" : ")[0];
        String code;
        switch (key) {
            case "EMAIL_EXISTS": code = "EMAIL_EXISTS"; break;
            case "EMAIL_NOT_FOUND":
            case "INVALID_PASSWORD":
            case "INVALID_LOGIN_CREDENTIALS": code = "INVALID_CREDENTIALS"; break;
            case "INVALID_EMAIL":
            case "MISSING_EMAIL": code = "INVALID_EMAIL"; break;
            case "WEAK_PASSWORD": code = "WEAK_PASSWORD"; break;
            case "TOO_MANY_ATTEMPTS_TRY_LATER":
            case "RESET_PASSWORD_EXCEED_LIMIT": code = "TOO_MANY_ATTEMPTS"; break;
            case "OPERATION_NOT_ALLOWED": code = "EMAIL_AUTH_DISABLED"; break;
            default: code = "AUTH_FAILED";
        }
        return new CloudException(code, raw, status);
    }

    private State reconcile(JSONObject activeDocument, JSONObject historyDocument) throws Exception {
        JSONObject active = normalizeDocument(activeDocument, false, System.currentTimeMillis());
        JSONObject history = normalizeDocument(historyDocument, true, System.currentTimeMillis());
        LinkedHashMap<String, JSONObject> activeById = mapById(active.optJSONArray("videos"));
        LinkedHashMap<String, JSONObject> historyById = mapById(history.optJSONArray("videos"));
        Set<String> ids = new LinkedHashSet<>(activeById.keySet());
        for (String id : ids) {
            JSONObject historyVideo = historyById.get(id);
            if (historyVideo == null) continue;
            if (compareRevision(activeById.get(id), historyVideo) > 0) historyById.remove(id);
            else activeById.remove(id);
        }
        return new State(toArray(activeById), toArray(historyById));
    }

    private JSONObject normalizeDocument(JSONObject source, boolean history, long now) throws Exception {
        LinkedHashMap<String, JSONObject> byId = new LinkedHashMap<>();
        JSONArray videos = source == null ? null : source.optJSONArray("videos");
        if (videos != null) {
            for (int i = 0; i < videos.length(); i++) {
                JSONObject normalized = normalizeVideo(videos.optJSONObject(i), history, now);
                if (normalized == null) continue;
                String id = normalized.optString("id");
                JSONObject existing = byId.get(id);
                if (existing == null || compareRevision(normalized, existing) > 0) byId.put(id, normalized);
            }
        }
        return document(toArray(byId), positiveLong(source == null ? null : source.opt("updatedAt"), now));
    }

    private JSONObject normalizeVideo(JSONObject source, boolean history, long now) throws Exception {
        if (source == null) return null;
        String id = source.optString("id");
        if (!id.matches("[a-zA-Z0-9_-]{6,20}")) return null;
        long addedAt = positiveLong(source.opt("addedAt"), now);
        long updatedAt = positiveLong(source.opt("updatedAt"), addedAt);
        JSONObject result = new JSONObject();
        result.put("id", id);
        result.put("title", nonEmpty(source.optString("title"), "YouTube video"));
        result.put("url", "https://www.youtube.com/watch?v=" + id);
        result.put("thumbnail", nonEmpty(source.optString("thumbnail"), "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"));
        result.put("channel", source.optString("channel", ""));
        putNullableNumber(result, "durationSeconds", source.opt("durationSeconds"), true);
        putNullableNumber(result, "publishedAt", source.opt("publishedAt"), true);
        putNullableNumber(result, "viewCount", source.opt("viewCount"), false);
        result.put("addedAt", addedAt);
        result.put("updatedAt", updatedAt);
        result.put("changeId", source.optString("changeId", ""));
        if (history) result.put("removedAt", positiveLong(source.opt("removedAt"), updatedAt));
        return result;
    }

    private JSONObject document(JSONArray videos, long updatedAt) throws Exception {
        return new JSONObject().put("format", DOCUMENT_FORMAT).put("schemaVersion", 1)
                .put("updatedAt", updatedAt).put("videos", videos);
    }

    private int compareRevision(JSONObject a, JSONObject b) {
        long left = positiveLong(a == null ? null : a.opt("updatedAt"), 0);
        long right = positiveLong(b == null ? null : b.opt("updatedAt"), 0);
        if (left != right) return left > right ? 1 : -1;
        return (a == null ? "" : a.optString("changeId", ""))
                .compareTo(b == null ? "" : b.optString("changeId", ""));
    }

    private LinkedHashMap<String, JSONObject> mapById(JSONArray videos) {
        LinkedHashMap<String, JSONObject> result = new LinkedHashMap<>();
        if (videos == null) return result;
        for (int i = 0; i < videos.length(); i++) {
            JSONObject video = videos.optJSONObject(i);
            if (video != null) result.put(video.optString("id"), video);
        }
        return result;
    }

    private JSONArray toArray(LinkedHashMap<String, JSONObject> values) {
        JSONArray result = new JSONArray();
        for (JSONObject value : values.values()) result.put(value);
        return result;
    }

    private JSONArray cloneArray(JSONArray source) throws Exception {
        return new JSONArray(source == null ? "[]" : source.toString());
    }

    private JSONObject findById(JSONArray videos, String id) {
        for (int i = 0; i < videos.length(); i++) {
            JSONObject video = videos.optJSONObject(i);
            if (video != null && id.equals(video.optString("id"))) return video;
        }
        return null;
    }

    private void removeById(JSONArray videos, String id) {
        for (int i = videos.length() - 1; i >= 0; i--) {
            JSONObject video = videos.optJSONObject(i);
            if (video != null && id.equals(video.optString("id"))) videos.remove(i);
        }
    }

    private void upsert(JSONArray videos, JSONObject value, boolean history, long now) throws Exception {
        removeById(videos, value.optString("id"));
        videos.put(normalizeVideo(value, history, now));
    }

    private String nonEmpty(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private long positiveLong(Object value, long fallback) {
        if (value == null || value == JSONObject.NULL) return fallback;
        try {
            long number = Math.round(Double.parseDouble(String.valueOf(value)));
            return number > 0 ? number : fallback;
        } catch (Exception ignored) { return fallback; }
    }

    private void putNullableNumber(JSONObject target, String key, Object value, boolean positiveOnly) throws Exception {
        if (value == null || value == JSONObject.NULL || String.valueOf(value).isEmpty()) {
            target.put(key, JSONObject.NULL);
            return;
        }
        try {
            double parsed = Double.parseDouble(String.valueOf(value));
            if (!Double.isFinite(parsed) || (positiveOnly ? parsed <= 0 : parsed < 0)) target.put(key, JSONObject.NULL);
            else target.put(key, Math.round(parsed));
        } catch (Exception ignored) { target.put(key, JSONObject.NULL); }
    }

    private JSONObject parseObject(String text) throws CloudException {
        try { return text == null || text.trim().isEmpty() ? new JSONObject() : new JSONObject(text); }
        catch (Exception error) { throw new CloudException("INVALID_CLOUD_DATA", "Firebase returned invalid JSON"); }
    }

    private String encode(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8").replace("+", "%20");
    }

    private Response request(String method, String url, String contentType, String body, Map<String, String> headers) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        if (headers != null) {
            for (Map.Entry<String, String> header : headers.entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }
        }
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", contentType);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        Response response = new Response();
        response.status = connection.getResponseCode();
        response.etag = connection.getHeaderField("ETag");
        InputStream stream = response.status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        response.body = readAll(stream);
        connection.disconnect();
        return response;
    }

    private String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = stream.read(buffer)) >= 0) output.write(buffer, 0, read);
        stream.close();
        return output.toString("UTF-8");
    }
}

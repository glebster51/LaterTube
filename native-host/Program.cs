using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

const string PackageName = "com.glebster51.latertube.localsync";
const string UnityAdb = @"C:\Program Files\Unity\Hub\Editor\6000.3.10f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe";

try
{
    JsonObject? request = ReadNativeMessage();
    if (request is null || request["action"]?.GetValue<string>() != "sync")
        throw new InvalidOperationException("Unsupported native request.");

    JsonArray videos = request["videos"] as JsonArray ?? new JsonArray();
    string adb = FindAdb();
    EnsureSingleAuthorizedDevice(adb);
    EnsurePhoneAppInstalled(adb);

    DeleteRemoteFile(adb, "sync-response.json");
    WriteRemoteJson(adb, "sync-request.json", new JsonObject { ["action"] = "sync", ["videos"] = videos.DeepClone() });
    LaunchPhoneApp(adb);
    JsonObject phoneResponse = ReadRemoteJson(adb, "sync-response.json");
    if (phoneResponse["ok"]?.GetValue<bool>() != true)
        throw new InvalidOperationException(phoneResponse["error"]?.GetValue<string>() ?? "Phone rejected synchronization.");

    JsonArray deletedIds = phoneResponse["deletedVideoIds"] as JsonArray ?? new JsonArray();
    JsonArray watchedIds = phoneResponse["watchedVideoIds"] as JsonArray ?? new JsonArray();
    JsonArray cachedThumbnailIds = phoneResponse["cachedThumbnailIds"] as JsonArray ?? new JsonArray();
    HashSet<string> deleted = deletedIds.Select(node => node?.GetValue<string>() ?? "").Where(id => id.Length > 0).ToHashSet();
    JsonArray currentVideos = new();
    foreach (JsonNode? video in videos)
    {
        if (!deleted.Contains(video?["id"]?.GetValue<string>() ?? "")) currentVideos.Add(video?.DeepClone());
    }

    await CacheMissingThumbnails(adb, currentVideos, cachedThumbnailIds);

    DeleteRemoteFile(adb, "sync-response.json");
    WriteRemoteJson(adb, "sync-request.json", new JsonObject { ["action"] = "ack", ["videos"] = currentVideos });
    LaunchPhoneApp(adb);
    JsonObject acknowledgement = ReadRemoteJson(adb, "sync-response.json");
    if (acknowledgement["ok"]?.GetValue<bool>() != true)
        throw new InvalidOperationException("Phone did not acknowledge synchronization.");

    WriteNativeMessage(new JsonObject {
        ["ok"] = true,
        ["deletedVideoIds"] = deletedIds.DeepClone(),
        ["watchedCount"] = watchedIds.Count
    });
}
catch (Exception error)
{
    Console.Error.WriteLine(error);
    WriteNativeMessage(new JsonObject { ["ok"] = false, ["error"] = error.Message });
}

static JsonObject? ReadNativeMessage()
{
    Stream input = Console.OpenStandardInput();
    byte[] header = ReadExact(input, 4);
    if (header.Length == 0) return null;
    int size = BitConverter.ToInt32(header, 0);
    if (size < 1 || size > 1024 * 1024) throw new InvalidOperationException("Invalid native message size.");
    return JsonNode.Parse(ReadExact(input, size)) as JsonObject;
}

static void WriteNativeMessage(JsonObject response)
{
    byte[] content = Encoding.UTF8.GetBytes(response.ToJsonString());
    Stream output = Console.OpenStandardOutput();
    output.Write(BitConverter.GetBytes(content.Length));
    output.Write(content);
    output.Flush();
}

static byte[] ReadExact(Stream stream, int count)
{
    byte[] data = new byte[count];
    int offset = 0;
    while (offset < count)
    {
        int read = stream.Read(data, offset, count - offset);
        if (read == 0) break;
        offset += read;
    }
    return offset == count ? data : (offset == 0 ? Array.Empty<byte>() : throw new EndOfStreamException("Incomplete native message."));
}

static string FindAdb()
{
    try
    {
        if (Run("adb", "version").ExitCode == 0) return "adb";
    }
    catch (Exception)
    {
        // The Unity SDK fallback below is the normal path on this PC.
    }
    if (File.Exists(UnityAdb)) return UnityAdb;
    throw new InvalidOperationException("adb was not found. Install Android platform-tools or Unity Android support.");
}

static void EnsureSingleAuthorizedDevice(string adb)
{
    List<string> devices = AuthorizedDevices(adb, out bool unauthorized);
    if (devices.Count == 0 && !unauthorized)
    {
        ConnectDiscoveredWirelessDevice(adb);
        devices = AuthorizedDevices(adb, out unauthorized);
    }
    if (unauthorized) throw new InvalidOperationException("Android device is unauthorized. Allow USB debugging on the phone.");
    if (devices.Count == 0) throw new InvalidOperationException("No authorized Android device found. Connect USB or enable paired Wireless debugging on the same Wi-Fi network.");
    if (devices.Count > 1) throw new InvalidOperationException("Multiple authorized Android devices are connected.");
}

static List<string> AuthorizedDevices(string adb, out bool unauthorized)
{
    ProcessResult result = Run(adb, "devices");
    string[] lines = result.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
    unauthorized = lines.Any(line => line.Contains("\tunauthorized", StringComparison.Ordinal));
    return lines.Where(line => line.Contains("\tdevice", StringComparison.Ordinal)).ToList();
}

static void ConnectDiscoveredWirelessDevice(string adb)
{
    ProcessResult result = RunWithTimeout(adb, "mdns services", TimeSpan.FromSeconds(2));
    string[] candidates = result.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
        .Where(line => line.Contains("_adb-tls-connect._tcp", StringComparison.Ordinal))
        .Select(line => System.Text.RegularExpressions.Regex.Match(line, @"(?<endpoint>(?:\d{1,3}\.){3}\d{1,3}:\d+)"))
        .Where(match => match.Success)
        .Select(match => match.Groups["endpoint"].Value)
        .Distinct(StringComparer.Ordinal)
        .ToArray();

    if (candidates.Length > 1)
        throw new InvalidOperationException("Multiple paired wireless Android devices were discovered.");
    if (candidates.Length == 1)
        Run(adb, $"connect {candidates[0]}");
}

static void EnsurePhoneAppInstalled(string adb)
{
    ProcessResult result = Run(adb, $"shell pm path {PackageName}");
    if (result.ExitCode != 0 || !result.Output.Contains("package:"))
        throw new InvalidOperationException("LaterTube Local Sync application is not installed on the phone.");
}

static void LaunchPhoneApp(string adb)
{
    ProcessResult result = Run(adb, $"shell am start -n {PackageName}/.MainActivity --activity-single-top");
    if (result.ExitCode != 0) throw new InvalidOperationException("Could not start LaterTube Local Sync on the phone.");
}

static void DeleteRemoteFile(string adb, string fileName) => Run(adb, $"shell run-as {PackageName} rm -f files/{fileName}");

static void WriteRemoteJson(string adb, string fileName, JsonObject value)
{
    string temporaryFile = Path.Combine(Path.GetTempPath(), $"latertube-usb-sync-{Guid.NewGuid():N}.json");
    const string deviceTemporaryFile = "/data/local/tmp/latertube-usb-sync-request.json";
    try
    {
        File.WriteAllText(temporaryFile, value.ToJsonString(), Encoding.UTF8);
        ProcessResult pushed = Run(adb, $"push \"{temporaryFile}\" {deviceTemporaryFile}");
        if (pushed.ExitCode != 0) throw new InvalidOperationException($"Could not send USB sync request: {pushed.Error.Trim()}");
        ProcessResult copied = Run(adb, $"shell run-as {PackageName} cp {deviceTemporaryFile} files/{fileName}");
        if (copied.ExitCode != 0) throw new InvalidOperationException($"Could not save USB sync request on phone: {copied.Error.Trim()}");
    }
    finally
    {
        try { File.Delete(temporaryFile); } catch (Exception) { }
        Run(adb, $"shell rm -f {deviceTemporaryFile}");
    }
}

static async Task CacheMissingThumbnails(string adb, JsonArray videos, JsonArray cachedThumbnailIds)
{
    HashSet<string> cached = cachedThumbnailIds.Select(node => node?.GetValue<string>() ?? "").ToHashSet();
    using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(8) };
    foreach (JsonNode? video in videos)
    {
        string id = video?["id"]?.GetValue<string>() ?? "";
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-zA-Z0-9_-]{6,20}$") || cached.Contains(id)) continue;
        try
        {
            byte[] image = await client.GetByteArrayAsync($"https://i.ytimg.com/vi/{id}/mqdefault.jpg");
            if (image.Length < 100 || image.Length > 300_000) continue;
            WriteRemoteBytes(adb, $"thumbnails/{id}.jpg", image);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Thumbnail {id} was skipped: {error.Message}");
        }
    }
}

static void WriteRemoteBytes(string adb, string relativePath, byte[] content)
{
    string temporaryFile = Path.Combine(Path.GetTempPath(), $"latertube-thumbnail-{Guid.NewGuid():N}.jpg");
    const string deviceTemporaryFile = "/data/local/tmp/latertube-thumbnail.jpg";
    try
    {
        File.WriteAllBytes(temporaryFile, content);
        ProcessResult pushed = Run(adb, $"push \"{temporaryFile}\" {deviceTemporaryFile}");
        if (pushed.ExitCode != 0) throw new InvalidOperationException(pushed.Error.Trim());
        ProcessResult directory = Run(adb, $"shell run-as {PackageName} mkdir -p files/thumbnails");
        if (directory.ExitCode != 0) throw new InvalidOperationException(directory.Error.Trim());
        ProcessResult copied = Run(adb, $"shell run-as {PackageName} cp {deviceTemporaryFile} files/{relativePath}");
        if (copied.ExitCode != 0) throw new InvalidOperationException(copied.Error.Trim());
    }
    finally
    {
        try { File.Delete(temporaryFile); } catch (Exception) { }
        Run(adb, $"shell rm -f {deviceTemporaryFile}");
    }
}

static JsonObject ReadRemoteJson(string adb, string fileName)
{
    for (int attempt = 0; attempt < 20; attempt++)
    {
        ProcessResult result = Run(adb, $"exec-out run-as {PackageName} cat files/{fileName}");
        if (result.ExitCode == 0 && result.Output.Trim().Length > 0)
        {
            JsonObject? resultJson = JsonNode.Parse(result.Output) as JsonObject;
            if (resultJson is not null) return resultJson;
        }
        Thread.Sleep(150);
    }
    throw new InvalidOperationException("Phone did not respond to the USB synchronization request.");
}

static ProcessResult Run(string executable, string arguments)
{
    ProcessStartInfo info = new(executable, arguments) {
        RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
    };
    using Process process = Process.Start(info) ?? throw new InvalidOperationException($"Could not start {executable}.");
    string output = process.StandardOutput.ReadToEnd();
    string error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    return new ProcessResult(process.ExitCode, output, error);
}

static ProcessResult RunWithTimeout(string executable, string arguments, TimeSpan timeout)
{
    ProcessStartInfo info = new(executable, arguments) {
        RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
    };
    using Process process = Process.Start(info) ?? throw new InvalidOperationException($"Could not start {executable}.");
    StringBuilder output = new();
    StringBuilder error = new();
    process.OutputDataReceived += (_, eventArgs) => { if (eventArgs.Data is not null) output.AppendLine(eventArgs.Data); };
    process.ErrorDataReceived += (_, eventArgs) => { if (eventArgs.Data is not null) error.AppendLine(eventArgs.Data); };
    process.BeginOutputReadLine();
    process.BeginErrorReadLine();
    if (!process.WaitForExit((int)timeout.TotalMilliseconds)) process.Kill(entireProcessTree: true);
    process.WaitForExit();
    return new ProcessResult(process.ExitCode, output.ToString(), error.ToString());
}

record ProcessResult(int ExitCode, string Output, string Error);

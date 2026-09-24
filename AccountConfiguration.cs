using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Mail;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public sealed class AccountSettings {
    public string provider { get; set; }
    public string email { get; set; }
    public string label { get; set; }
    public string home { get; set; }
    public string plan { get; set; }
    public string cli { get; set; }
    internal Dictionary<string, object> original = new Dictionary<string, object>();
}

public sealed class AccountConfiguration {
    const int MaximumBytes = 1024 * 1024;
    readonly Dictionary<string, object> root;
    byte[] originalBytes;
    public string ConfigurationPath { get; private set; }
    public List<AccountSettings> Accounts { get; private set; }

    AccountConfiguration(string path, Dictionary<string, object> data, byte[] bytes) {
        ConfigurationPath = path; root = data; originalBytes = bytes;
        Accounts = new List<AccountSettings>();
    }

    public static string DefaultPath(string appDirectory) {
        string setting = Environment.GetEnvironmentVariable("WEEKLY_USAGE_CONFIG");
        return Path.GetFullPath(Path.Combine(appDirectory, String.IsNullOrEmpty(setting) ? "accounts.json" : setting));
    }

    public static AccountConfiguration Open(string path) {
        path = Path.GetFullPath(path);
        if (!File.Exists(path)) return new AccountConfiguration(path, new Dictionary<string, object>(), null);
        byte[] bytes = ReadBytes(path);
        Dictionary<string, object> data;
        try {
            string json = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF');
            ValidateJson(json);
            data = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
        } catch (Exception error) {
            if (!(error is ArgumentException || error is InvalidOperationException || error is FormatException)) throw;
            throw new InvalidDataException("Configuration is not valid UTF-8 JSON. Fix " + path + " before saving. Use forward slashes in Windows paths.");
        }
        object entries;
        if (data == null || !data.TryGetValue("accounts", out entries) || !(entries is object[]))
            throw new InvalidDataException("Configuration must contain an accounts array. Fix " + path + " before saving.");
        var result = new AccountConfiguration(path, data, bytes);
        foreach (object entry in (object[])entries) {
            var fields = entry as Dictionary<string, object>;
            if (fields == null) throw new InvalidDataException("Every accounts entry must be a JSON object.");
            result.Accounts.Add(new AccountSettings { provider = Field(fields, "provider"), email = Field(fields, "email"),
                label = Field(fields, "label"), home = Field(fields, "home"), plan = Field(fields, "plan"),
                cli = Field(fields, "cli"), original = fields });
        }
        result.Validate();
        return result;
    }

    public void Save() {
        Validate();
        var output = new Dictionary<string, object>(root);
        var entries = new List<Dictionary<string, object>>();
        foreach (AccountSettings account in Accounts) {
            var fields = new Dictionary<string, object>(account.original);
            Set(fields, "provider", account.provider); Set(fields, "email", account.email);
            Set(fields, "label", account.label); Set(fields, "home", account.home);
            Set(fields, "plan", account.plan); Set(fields, "cli", account.cli);
            entries.Add(fields);
        }
        output["accounts"] = entries;
        byte[] bytes = new UTF8Encoding(false).GetBytes(new JavaScriptSerializer().Serialize(output) + Environment.NewLine);
        if (bytes.Length > MaximumBytes) throw new InvalidDataException("Configuration is too large. Keep it below 1 MB.");
        CheckUnchanged();
        string directory = Path.GetDirectoryName(ConfigurationPath);
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("Configuration folder does not exist: " + directory);
        string temporary = Path.Combine(directory, ".weekly-usage-" + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
            }
            for (int attempt = 0; ; attempt++) {
                CheckUnchanged();
                try {
                    if (originalBytes == null) File.Move(temporary, ConfigurationPath);
                    else File.Replace(temporary, ConfigurationPath, null);
                    break;
                } catch (IOException error) {
                    int code = error.HResult & 0xffff;
                    if (attempt == 3 || (code != 32 && code != 33 && code != 1175)) throw;
                    Thread.Sleep(50 * (attempt + 1));
                }
            }
            originalBytes = bytes;
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    void CheckUnchanged() {
        byte[] current = File.Exists(ConfigurationPath) ? ReadBytes(ConfigurationPath) : null;
        if ((current == null) != (originalBytes == null) ||
            (current != null && !EqualBytes(current, originalBytes)))
            throw new IOException("Configuration changed in another window or editor. Close this dialog and reopen Manage accounts before saving.");
    }

    static bool EqualBytes(byte[] first, byte[] second) {
        if (first.Length != second.Length) return false;
        for (int i = 0; i < first.Length; i++) if (first[i] != second[i]) return false;
        return true;
    }

    // JavaScriptSerializer also accepts JavaScript literals that JSON.parse rejects.
    static void ValidateJson(string json) {
        var token = new Regex(@"\G[ \t\r\n]*(?<value>""(?:[^""\\\x00-\x1f]|\\(?:[""\\/bfnrt]|u[0-9a-fA-F]{4}))*""|true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![0-9.eE+-])|[\[\]{}:,])[ \t\r\n]*");
        int position = 0; string previous = "";
        while (position < json.Length) {
            Match match = token.Match(json, position);
            if (!match.Success) throw new FormatException();
            string value = match.Groups["value"].Value;
            if (value == ":" && !previous.StartsWith("\"")) throw new FormatException();
            previous = value; position += match.Length;
        }
    }

    static byte[] ReadBytes(string path) {
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            if (stream.Length > MaximumBytes) throw new InvalidDataException("Configuration or profile file is too large (over 1 MB): " + path);
            using (var memory = new MemoryStream()) { stream.CopyTo(memory); return memory.ToArray(); }
        }
    }

    void Validate() {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < Accounts.Count; i++) {
            AccountSettings account = Accounts[i];
            string prefix = "Account " + (i + 1) + ": ";
            if (account == null) throw new InvalidDataException(prefix + "choose a provider and enter its email.");
            account.provider = (account.provider ?? "").Trim().ToLowerInvariant();
            account.email = (account.email ?? "").Trim();
            if (Array.IndexOf(new[] { "claude", "codex", "grok", "devin" }, account.provider) < 0)
                throw new InvalidDataException(prefix + "choose Claude, Codex, Grok or Devin.");
            if (!ValidEmail(account.email)) throw new InvalidDataException(prefix + "enter the email used to sign in to this provider.");
            if (!seen.Add(account.provider + ":" + account.email))
                throw new InvalidDataException(prefix + "this provider and email already exist. Edit that account instead.");
            foreach (string value in new[] { account.label, account.home, account.plan, account.cli }) {
                if (value != null && (value.IndexOf('\0') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0))
                    throw new InvalidDataException(prefix + "labels, paths and plans must be a single line without control characters.");
            }
            if (!String.IsNullOrWhiteSpace(account.home)) {
                try { ProfilePath(account.provider, account.home); }
                catch (ArgumentException) { throw new InvalidDataException(prefix + "enter a valid profile folder path."); }
                catch (NotSupportedException) { throw new InvalidDataException(prefix + "enter a valid local profile folder path."); }
            }
        }
    }

    static string Field(Dictionary<string, object> fields, string name) {
        object value;
        if (!fields.TryGetValue(name, out value) || value == null) return "";
        if (!(value is string)) throw new InvalidDataException("Account field '" + name + "' must be text.");
        return (string)value;
    }

    static void Set(Dictionary<string, object> fields, string name, string value) {
        if (String.IsNullOrWhiteSpace(value)) fields.Remove(name); else fields[name] = value;
    }

    static bool ValidEmail(string value) {
        if (String.IsNullOrWhiteSpace(value) || value.IndexOf('@') < 1 || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) return false;
        try { return new MailAddress(value).Address == value; } catch (FormatException) { return false; }
    }

    public static string DefaultHome(string provider) {
        return provider == "devin" ? "" : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "." + provider);
    }

    static string ProfilePath(string provider, string home) {
        return ProfilePath(provider, home, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    }

    static string ProfilePath(string provider, string home, string userRoot) {
        string value = String.IsNullOrWhiteSpace(home) ? (provider == "devin" ? "" : Path.Combine(userRoot, "." + provider)) : home.Trim();
        if (value == "~" || value.StartsWith("~/") || value.StartsWith("~\\"))
            value = userRoot + value.Substring(1);
        return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, value));
    }

    static Dictionary<string, object> ReadProfile(string path) {
        if (!File.Exists(path)) return null;
        string json = new UTF8Encoding(false, true).GetString(ReadBytes(path)).TrimStart('\uFEFF');
        return new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
    }

    static object Value(Dictionary<string, object> data, string key) {
        object value; return data != null && data.TryGetValue(key, out value) ? value : null;
    }

    public static string DetectEmail(string provider, string home) {
        return DetectEmail(provider, home, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    }

    internal static string DetectEmail(string provider, string home, string userRoot) {
        if (provider == "devin") return "";
        try {
            string folder = ProfilePath(provider, home, userRoot), email = "";
            if (provider == "claude") {
                var metadata = ReadProfile(Path.Combine(String.IsNullOrWhiteSpace(home) ? userRoot : folder, ".claude.json"));
                if (metadata == null && !String.IsNullOrWhiteSpace(home) &&
                    String.Equals(folder.TrimEnd('\\', '/'), Path.Combine(userRoot, ".claude"), StringComparison.OrdinalIgnoreCase))
                    metadata = ReadProfile(Path.Combine(userRoot, ".claude.json"));
                email = Value(Value(metadata, "oauthAccount") as Dictionary<string, object>, "emailAddress") as string;
            } else if (provider == "codex") {
                var auth = ReadProfile(Path.Combine(folder, "auth.json"));
                string token = Value(Value(auth, "tokens") as Dictionary<string, object>, "id_token") as string;
                if (String.IsNullOrEmpty(token) || token.Split('.').Length != 3) return "";
                string payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
                payload = payload.PadRight((payload.Length + 3) / 4 * 4, '=');
                var identity = new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String(payload))) as Dictionary<string, object>;
                email = Value(identity, "email") as string;
            } else if (provider == "grok") {
                var auth = ReadProfile(Path.Combine(folder, "auth.json"));
                var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (auth != null) foreach (object entry in auth.Values) {
                    string candidate = Value(entry as Dictionary<string, object>, "email") as string;
                    if (ValidEmail(candidate)) identities.Add(candidate);
                }
                if (identities.Count == 1) foreach (string identity in identities) email = identity;
            }
            return ValidEmail(email) ? email : "";
        } catch (Exception error) {
            if (error is IOException || error is InvalidDataException || error is UnauthorizedAccessException || error is ArgumentException ||
                error is InvalidOperationException || error is FormatException || error is NotSupportedException) return "";
            throw;
        }
    }

    static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    static string Comment(string value) { return "# " + value.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\r\n# "); }

    public static string SignInHelp(AccountSettings account) {
        if (account == null) return Comment("Select an account first.");
        string intro = Comment("Run this in a new PowerShell window. Sign in as " + account.email + ".") + "\r\n\r\n";
        string folder = ProfilePath(account.provider, account.home), quoted = Quote(folder);
        if (account.provider == "claude") {
            string select = String.IsNullOrWhiteSpace(account.home)
                ? "Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue"
                : "$env:CLAUDE_CONFIG_DIR = " + quoted;
            return intro + select + "\r\nclaude\r\n\r\n" + Comment("In Claude Code, enter /login and choose " + account.email + ". Then return here and click Refresh now.");
        }
        if (account.provider == "codex") return intro + "New-Item -ItemType Directory -Force -Path " + quoted +
            " | Out-Null\r\n$env:CODEX_HOME = " + quoted + "\r\ncodex login\r\n\r\n# Then return here and click Refresh now.";
        if (account.provider == "grok") {
            if (!String.Equals(folder.TrimEnd('\\', '/'), DefaultHome("grok"), StringComparison.OrdinalIgnoreCase))
                return Comment("Sign in as " + account.email + " using your existing Grok profile launcher for:\r\n" + folder +
                    "\r\n\r\nNo supported custom-folder sign-in flag is known. Follow that launcher's login flow, confirm its auth.json is in this folder, then click Refresh now.");
            return intro + "grok login\r\n\r\n# Then return here and click Refresh now.";
        }
        if (account.provider == "devin") return intro + "& " + Quote(String.IsNullOrWhiteSpace(account.cli) ? "devin" : account.cli) +
            " auth login\r\n\r\n# Use the default server.codeium.com login. Then return here and click Refresh now.";
        return Comment("Choose a supported provider before requesting sign-in help.");
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class AccountConfigurationTests {
    static int passed;
    static readonly string directory = Path.Combine(Path.GetTempPath(), "weekly-usage-config-tests-" + Guid.NewGuid().ToString("N"));
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); passed++; }
    static void Reject(Action action, string message) {
        bool rejected = false;
        try { action(); } catch (IOException) { rejected = true; } catch (InvalidDataException) { rejected = true; }
        Check(rejected, message);
    }
    static void Write(string path, string value) { File.WriteAllText(path, value, new UTF8Encoding(false)); }
    static string FilePath(string name) { return Path.Combine(directory, name); }
    static AccountSettings Account(string provider, string email) { return new AccountSettings { provider = provider, email = email }; }
    static string Profile(string name) { string path = FilePath(name); Directory.CreateDirectory(path); return path; }
    static string Token(string email) {
        return "header." + Convert.ToBase64String(Encoding.UTF8.GetBytes(json.Serialize(new { email = email }))).TrimEnd('=').Replace('+', '-').Replace('/', '_') + ".signature";
    }
    static void CommandsOnly(string help, params string[] expected) {
        var actual = new List<string>();
        foreach (string line in help.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries))
            if (!line.TrimStart().StartsWith("#")) actual.Add(line);
        Check(String.Join("\n", actual) == String.Join("\n", expected), "Copied recovery block must contain only the intended executable commands.");
    }

    public static int Main() {
        Directory.CreateDirectory(directory);
        try {
            RoundTrip(); InvalidConfigurations(); ConcurrentEdits(); IdentityDetection(); RecoveryAndPaths();
            Console.WriteLine("Configuration tests passed: " + passed); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(directory, true); }
    }

    static void RoundTrip() {
        string path = FilePath("roundtrip.json");
        var config = AccountConfiguration.Open(path);
        Check(config.Accounts.Count == 0 && !File.Exists(path), "Missing config must be an unwritten empty roster.");
        config.Accounts.Add(Account("Claude", " Me@example.com ")); config.Save();
        Check(AccountConfiguration.Open(path).Accounts[0].email == "Me@example.com", "Email must trim.");
        Check(config.Accounts[0].provider == "claude", "Provider must normalize.");
        Check(!File.ReadAllText(path).Contains("label"), "New empty optional fields must be omitted.");
        Check(File.ReadAllBytes(path)[0] == (byte)'{', "Saved JSON must be UTF-8 without BOM.");
        Write(path, "{\"version\":2,\"future\":{\"enabled\":true},\"accounts\":[{\"provider\":\"codex\",\"email\":\"a@example.com\",\"home\":\"~/.codex-work\",\"cli\":\"C:/my tools/devin.exe\",\"plan\":\"Custom\",\"futureAccount\":{\"flags\":[1,2]}}]}");
        config = AccountConfiguration.Open(path); config.Accounts[0].label = "Work's login"; config.Save();
        var data = json.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
        var entry = ((object[])data["accounts"])[0] as Dictionary<string, object>;
        Check((int)data["version"] == 2 && data.ContainsKey("future"), "Unknown root fields must survive.");
        Check(entry.ContainsKey("futureAccount"), "Unknown account fields must survive.");
        Check((string)entry["home"] == "~/.codex-work" && (string)entry["plan"] == "Custom" && (string)entry["cli"] == "C:/my tools/devin.exe", "Optional fields must survive editing.");
        config.Accounts[0].label = ""; config.Save();
        Check(!File.ReadAllText(path).Contains("label"), "Cleared optional fields must be removed.");
        config.Accounts.Clear(); config.Save();
        Check(AccountConfiguration.Open(path).Accounts.Count == 0, "Removing the last account must save an empty roster.");
        Check(Directory.GetFiles(directory, "*.tmp").Length == 0, "Successful saves must leave no temp files.");
    }

    static void InvalidConfigurations() {
        string path = FilePath("invalid.json");
        foreach (string invalid in new[] { "broken", "{}", "[]", "null", "{\"accounts\":{}}", "{\"accounts\":[null]}",
            "{'accounts':[]}", "{accounts:[]}", "{\"accounts\":[],}", "{\"accounts\":[]} {}",
            "{\"accounts\":[],\"x\":NaN}", "{\"accounts\":[],\"x\":Infinity}", "{\"accounts\":[],\"x\":01}",
            "{\"accounts\":[],\"x\":1.}", "{\"accounts\":[],\"x\":+1}", "{\"accounts\":[],\"x\":\"bad\\x12\"}",
            "{\"accounts\":[{\"provider\":\"codex\",\"email\":42}]}" }) {
            Write(path, invalid); Reject(delegate { AccountConfiguration.Open(path); }, "Invalid JSON/schema accepted: " + invalid);
            Check(File.ReadAllText(path) == invalid, "Invalid input must remain untouched.");
        }
        File.WriteAllText(path, "{\"accounts\":[]}", Encoding.Unicode);
        Reject(delegate { AccountConfiguration.Open(path); }, "UTF-16 must be refused.");
        File.Delete(path); var config = AccountConfiguration.Open(path);
        config.Accounts.Add(Account("codex", "a@example.com")); config.Accounts.Add(Account("CODEX", "A@example.com"));
        Reject(delegate { config.Save(); }, "Case-insensitive duplicate accounts must be refused.");
        Check(!File.Exists(path), "Failed validation must not create a config.");
        config.Accounts.RemoveAt(1); config.Accounts[0].email = "not an email";
        Reject(delegate { config.Save(); }, "Invalid email must be refused.");
        config.Accounts[0].email = "a@example.com"; config.Accounts[0].home = "bad\npath";
        Reject(delegate { config.Save(); }, "Multiline paths must be refused.");
    }

    static void ConcurrentEdits() {
        string path = FilePath("concurrent.json"); var first = AccountConfiguration.Open(path); var second = AccountConfiguration.Open(path);
        first.Accounts.Add(Account("codex", "a@example.com")); first.Save();
        second.Accounts.Add(Account("claude", "b@example.com")); Reject(delegate { second.Save(); }, "Concurrent creation must be refused.");
        var stale = AccountConfiguration.Open(path); Write(path, "{\"accounts\":[],\"external\":true}");
        Reject(delegate { stale.Save(); }, "External edits must be refused.");
        try { stale.Save(); } catch (IOException error) { Check(error.Message.Contains("reopen Manage accounts"), "Drift recovery must name the visible Manage accounts action."); }
        Check(File.ReadAllText(path).Contains("external"), "External edits must be preserved.");
        stale = AccountConfiguration.Open(path); File.Delete(path);
        Reject(delegate { stale.Save(); }, "External deletion must be refused.");
    }

    static void IdentityDetection() {
        string userRoot = Profile("synthetic-user"), defaultClaude = Path.Combine(userRoot, ".claude");
        Directory.CreateDirectory(defaultClaude);
        Write(Path.Combine(userRoot, ".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"default@example.com\"}}");
        Write(Path.Combine(defaultClaude, ".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"explicit@example.com\"}}");
        Check(AccountConfiguration.DetectEmail("claude", "", userRoot) == "default@example.com", "Blank Claude home must use only conventional metadata, matching the collector.");
        Check(AccountConfiguration.DetectEmail("claude", "~/.claude", userRoot) == "explicit@example.com", "Explicit default Claude folder must prefer its selected metadata.");
        File.Delete(Path.Combine(defaultClaude, ".claude.json"));
        Check(AccountConfiguration.DetectEmail("claude", "~/.claude", userRoot) == "default@example.com", "Explicit default Claude folder may fall back to conventional metadata when selected metadata is absent.");
        string claude = Profile("claude-profile");
        Write(Path.Combine(claude, ".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"claude@example.com\"}}");
        Check(AccountConfiguration.DetectEmail("claude", claude) == "claude@example.com", "Claude custom identity must be detected.");
        string codex = Profile("codex-profile");
        Write(Path.Combine(codex, "auth.json"), json.Serialize(new { tokens = new { id_token = Token("codex@example.com"), access_token = "synthetic-private-token" } }));
        Check(AccountConfiguration.DetectEmail("codex", codex) == "codex@example.com", "Codex ID-token email must be detected.");
        Write(Path.Combine(codex, "auth.json"), "{\"tokens\":{\"id_token\":\"broken\"}}");
        Check(AccountConfiguration.DetectEmail("codex", codex) == "", "Malformed token must not guess an identity.");
        string grok = Profile("grok-profile");
        Write(Path.Combine(grok, "auth.json"), "{\"one\":{\"email\":\"grok@example.com\"},\"two\":{\"email\":\"GROK@example.com\"}}");
        Check(AccountConfiguration.DetectEmail("grok", grok) == "grok@example.com", "Grok matching metadata identities must deduplicate.");
        Write(Path.Combine(grok, "auth.json"), "{\"one\":{\"email\":\"grok@example.com\"},\"two\":{\"email\":\"other@example.com\"}}");
        Check(AccountConfiguration.DetectEmail("grok", grok) == "", "Ambiguous Grok identity must require manual email.");
        Check(AccountConfiguration.DetectEmail("codex", Profile("empty-profile")) == "", "A selected empty profile must not fall back to another login.");
        Check(AccountConfiguration.DetectEmail("devin", claude) == "", "Devin identity must be entered manually.");
    }

    static void RecoveryAndPaths() {
        string old = Environment.GetEnvironmentVariable("WEEKLY_USAGE_CONFIG");
        try {
            Environment.SetEnvironmentVariable("WEEKLY_USAGE_CONFIG", "relative/accounts.json");
            Check(AccountConfiguration.DefaultPath(directory) == Path.Combine(directory, "relative", "accounts.json"), "Relative config override must resolve from app directory.");
            Environment.SetEnvironmentVariable("WEEKLY_USAGE_CONFIG", null);
            Check(AccountConfiguration.DefaultPath(directory) == FilePath("accounts.json"), "Default config must be beside the app.");
        } finally { Environment.SetEnvironmentVariable("WEEKLY_USAGE_CONFIG", old); }
        var account = Account("codex", "me@example.com"); account.home = "~/O'Brien profile";
        string help = AccountConfiguration.SignInHelp(account);
        string quoted = "'" + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "O'Brien profile").Replace("'", "''") + "'";
        CommandsOnly(help, "New-Item -ItemType Directory -Force -Path " + quoted + " | Out-Null", "$env:CODEX_HOME = " + quoted, "codex login");
        Check(help.Contains("O''Brien profile'") && help.Contains("$env:CODEX_HOME") && help.Contains("codex login"), "Codex paths must be safely quoted and account-specific.");
        Check(help.Contains(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)) && !help.Contains("~/"), "Tilde paths must expand.");
        account.provider = "claude"; help = AccountConfiguration.SignInHelp(account);
        CommandsOnly(help, "$env:CLAUDE_CONFIG_DIR = " + quoted, "claude");
        Check(help.Contains("$env:CLAUDE_CONFIG_DIR") && help.Contains("/login") && !help.Contains("/usage"), "Claude recovery must select the profile and use /login.");
        account.home = AccountConfiguration.DefaultHome("claude");
        CommandsOnly(AccountConfiguration.SignInHelp(account), "$env:CLAUDE_CONFIG_DIR = '" + account.home.Replace("'", "''") + "'", "claude");
        account.home = "";
        CommandsOnly(AccountConfiguration.SignInHelp(account), "Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue", "claude");
        account.home = "~/O'Brien profile";
        account.provider = "grok"; help = AccountConfiguration.SignInHelp(account);
        CommandsOnly(help);
        Check(help.Contains("existing Grok profile launcher") && !help.Contains("--home"), "Grok custom profile guidance must not invent flags.");
        account.home = ""; CommandsOnly(AccountConfiguration.SignInHelp(account), "grok login");
        account.provider = "devin"; account.cli = "C:/O'Brien/devin.exe";
        Check(AccountConfiguration.SignInHelp(account).Contains("& 'C:/O''Brien/devin.exe' auth login"), "Devin CLI path must be safely quoted.");
        CommandsOnly(AccountConfiguration.SignInHelp(account), "& 'C:/O''Brien/devin.exe' auth login");
        CommandsOnly(AccountConfiguration.SignInHelp(null));
    }
}

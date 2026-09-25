using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

public static class NativeSmokeTests {
    static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static string sandbox, config, profile;
    static int checks;
    [STAThread] public static int Main(string[] args) {
        sandbox = Path.Combine(Path.GetTempPath(), "WeeklyUsage-native-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(sandbox);
        config = Path.Combine(sandbox, "accounts.json");
        profile = Path.Combine(sandbox, "demo-profile"); Directory.CreateDirectory(profile);
        // Only the test process and its collector child see this synthetic user profile.
        Environment.SetEnvironmentVariable("USERPROFILE", sandbox);
        Environment.SetEnvironmentVariable("WEEKLY_USAGE_CONFIG", config);
        foreach (string file in new[] { "collect.cjs", "grok.cjs", "devin.cjs" })
            File.Copy(Path.Combine(args[0], file), Path.Combine(sandbox, file));
        string bundledNode = Path.Combine(args[0], "runtime", "node.exe");
        if (File.Exists(bundledNode)) {
            Directory.CreateDirectory(Path.Combine(sandbox, "runtime"));
            File.Copy(bundledNode, Path.Combine(sandbox, "runtime", "node.exe"));
            Environment.SetEnvironmentVariable("PATH", "");
        }
        File.WriteAllText(Path.Combine(profile, ".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"demo@example.com\"}}");
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        int result = 1;
        using (var host = new Form { ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-30000, -30000) }) {
            host.Shown += delegate { host.BeginInvoke((MethodInvoker)delegate { result = RunChecks(); host.Close(); }); };
            Application.Run(host);
        }
        return result;
    }
    static int RunChecks() {
        try {
            RuntimeSelection();
            using (var window = Dashboard()) {
                Check(Field<Panel>(window, "welcome").Visible, "first run shows a welcome screen");
                Check(!Field<Button>(window, "help").Enabled, "sign-in help waits for an account");
                Capture(window, "welcome");
                DriveEditor(delegate { Field<Button>(window, "first").PerformClick(); }, delegate(AccountSetupForm editor) {
                    Field<TextBox>(editor, "home").Text = profile;
                    Field<Button>(editor, "find").PerformClick();
                    Check(Field<TextBox>(editor, "email").Text == "demo@example.com", "existing profile fills its identity");
                    Capture(editor, "account-setup");
                    Button(editor, "Save account").PerformClick();
                });
                Pump(delegate { return !Field<bool>(window, "busy"); });
                var grid = Field<DataGridView>(window, "grid");
                Check(grid.Rows.Count == 1, "saving the first account checks its quota");
                Check((string)grid.Rows[0].Cells[6].Value == "Unavailable", "missing login is never shown as zero or live");
                Check(!Field<Panel>(window, "welcome").Visible, "account result replaces welcome screen");
                Check(Field<Button>(window, "help").Enabled, "unavailable account has recovery action");
                Capture(window, "missing-login");
                string instructions = AccountConfiguration.SignInHelp(AccountConfiguration.Open(config).Accounts[0]);
                Check(instructions.Contains(profile) && instructions.Contains("CLAUDE_CONFIG_DIR"), "recovery names the selected profile");
                Check(!File.Exists(Path.Combine(profile, ".credentials.json")), "setup did not create credentials");
                var cached = new Snapshot { accounts = new System.Collections.Generic.List<Account>() };
                cached.accounts.Add(Demo("claude", "Old label", 38)); cached.accounts.Add(Demo("codex", "Removed account", 74));
                string cachedJson = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(cached);
                typeof(WeeklyUsage).GetMethod("LoadSnapshot", Private).Invoke(window, new object[] { cachedJson });
                Check(grid.Rows.Count == 1 && (string)grid.Rows[0].Cells[0].Value == "Claude", "cache cannot restore an account removed from a nonempty roster");
                Check(!((string)grid.Rows[0].Cells[1].Value).Contains("Old label"), "cached rows use the current account label");
            }
            string saved = File.ReadAllText(config);
            using (var editor = Editor()) {
                Button(editor, "New account").PerformClick();
                Field<TextBox>(editor, "email").Text = "demo@example.com";
                Button(editor, "Save account").PerformClick();
                Check(editor.DialogResult != DialogResult.OK, "duplicate account stays in the editor");
                Check(Field<Label>(editor, "feedback").Text.Length > 0, "duplicate account has actionable feedback");
                Check(File.ReadAllText(config) == saved, "duplicate save preserves configuration");
            }
            using (var editor = Editor()) {
                Field<TextBox>(editor, "email").Text = "invalid-email";
                Button(editor, "Save account").PerformClick();
                Check(editor.DialogResult != DialogResult.OK, "invalid email cannot be saved");
                Check(File.ReadAllText(config) == saved, "invalid email preserves configuration");
            }
            using (var editor = Editor()) {
                Field<TextBox>(editor, "label").Text = "Unsaved change";
                Button(editor, "Cancel").PerformClick();
                Check(File.ReadAllText(config) == saved, "cancel writes no settings");
            }
            using (var editor = Editor()) {
                Field<TextBox>(editor, "label").Text = "External edit test";
                File.AppendAllText(config, "\n");
                Button(editor, "Save account").PerformClick();
                Check(editor.DialogResult != DialogResult.OK, "external edits prevent an overwrite");
                Check(File.ReadAllText(config) == saved + "\n", "external edits remain intact");
            }
            File.WriteAllText(config, "{ invalid json }");
            using (var window = Dashboard()) {
                Check(Field<Panel>(window, "welcome").Visible, "malformed settings keep setup reachable");
                Check(Field<Label>(window, "footer").Text.Contains("Open configuration"), "malformed settings explain recovery");
            }
            File.WriteAllText(config, "{\"accounts\":[]}");
            using (var window = Dashboard()) {
                Check(Field<Panel>(window, "welcome").Visible, "empty roster returns to first-run setup");
                Check(Field<DataGridView>(window, "grid").Rows.Count == 0, "empty roster never restores removed cached accounts");
                var snapshot = new Snapshot { generatedAt = DateTimeOffset.UtcNow.ToString("o"), accounts = new System.Collections.Generic.List<Account>() };
                snapshot.accounts.Add(Demo("claude", "Personal", 38)); snapshot.accounts.Add(Demo("codex", "Work", 74));
                snapshot.accounts.Add(Demo("grok", "Personal", 6));
                FieldInfo state = typeof(WeeklyUsage).GetField("snapshot", Private); state.SetValue(window, snapshot);
                typeof(WeeklyUsage).GetMethod("Render", Private).Invoke(window, null);
                window.Text = "Weekly AI Usage - demo data";
                Capture(window, "dashboard-demo");
                Check(Field<DataGridView>(window, "grid").Rows.Count == 3, "quota rows render with synthetic readings");
            }
            Console.WriteLine("PASS: " + checks + " native onboarding checks. Screenshots: " + sandbox);
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
    static void RuntimeSelection() {
        var method = typeof(WeeklyUsage).GetMethod("FindNode", BindingFlags.NonPublic | BindingFlags.Static);
        string folder = Path.Combine(sandbox, "runtime-selection"), system = Path.Combine(folder, "system");
        Directory.CreateDirectory(Path.Combine(folder, "runtime")); Directory.CreateDirectory(Path.Combine(system, "nodejs"));
        Check((string)method.Invoke(null, new object[] { folder, system }) == "node.exe", "source builds retain PATH fallback");
        string installed = Path.Combine(system, "nodejs", "node.exe"); File.WriteAllText(installed, "fixture");
        Check((string)method.Invoke(null, new object[] { folder, system }) == installed, "source builds retain installed Node fallback");
        string bundled = Path.Combine(folder, "runtime", "node.exe"); File.WriteAllText(bundled, "fixture");
        Check((string)method.Invoke(null, new object[] { folder, system }) == bundled, "bundled runtime takes priority over system Node");
        if (File.Exists(Path.Combine(sandbox, "runtime", "node.exe")))
            Check((string)method.Invoke(null, new object[] { sandbox, system }) == Path.Combine(sandbox, "runtime", "node.exe"),
                "installed application selects its bundled runtime with an empty PATH");
    }
    static Account Demo(string provider, string label, double used) {
        return new Account { id = provider + ":demo@example.com", provider = provider, email = "demo@example.com", label = label,
            plan = "Demo", status = "Live", capturedAt = DateTimeOffset.UtcNow.ToString("o"),
            weekly = new Quota { used = used, remaining = 100 - used, reset = DateTimeOffset.UtcNow.AddDays(3).ToString("o") },
            session = new Quota { used = 12, remaining = 88, reset = DateTimeOffset.UtcNow.AddHours(2).ToString("o") }, sessionLabel = "5 hours" };
    }
    static WeeklyUsage Dashboard() {
        var window = new WeeklyUsage();
        typeof(WeeklyUsage).GetField("appDirectory", Private).SetValue(window, sandbox);
        Field<NotifyIcon>(window, "tray").Visible = false;
        Offscreen(window); Application.DoEvents();
        Pump(delegate { return !Field<bool>(window, "busy"); });
        return window;
    }
    static AccountSetupForm Editor() {
        var editor = new AccountSetupForm(config); Offscreen(editor); return editor;
    }
    static void Offscreen(Form form) {
        form.ShowInTaskbar = false; form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-30000, -30000);
        form.Show(); Application.DoEvents();
    }
    static void DriveEditor(Action open, Action<AccountSetupForm> action) {
        Exception failure = null; bool driven = false;
        using (var timer = new System.Windows.Forms.Timer { Interval = 30 }) {
            timer.Tick += delegate {
                AccountSetupForm editor = null;
                foreach (Form form in Application.OpenForms) if (form is AccountSetupForm) editor = (AccountSetupForm)form;
                if (editor == null) return;
                timer.Stop(); driven = true;
                try {
                    action(editor);
                    if (editor.DialogResult != DialogResult.OK) throw new Exception("Account editor did not complete: " + Field<Label>(editor, "feedback").Text);
                }
                catch (Exception e) { failure = e; editor.DialogResult = DialogResult.Cancel; editor.Close(); }
            };
            timer.Start(); open();
        }
        if (failure != null) throw failure;
        Check(driven, "welcome action opens the account editor");
    }
    static T Field<T>(object instance, string name) { return (T)instance.GetType().GetField(name, Private).GetValue(instance); }
    static Button Button(Control parent, string text) {
        foreach (Control control in parent.Controls) if (control is Button && control.Text == text) return (Button)control;
        throw new Exception("Button missing: " + text);
    }
    static void Pump(Func<bool> finished) {
        var watch = Stopwatch.StartNew();
        do { Application.DoEvents(); if (finished()) return; Thread.Sleep(20); } while (watch.ElapsedMilliseconds < 45000);
        throw new Exception("Native UI operation timed out");
    }
    static void Check(bool condition, string message) { if (!condition) throw new Exception("FAIL: " + message); checks++; }
    static void Capture(Form form, string name) {
        using (var bitmap = new Bitmap(form.Width, form.Height)) {
            form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height));
            bitmap.Save(Path.Combine(sandbox, name + ".png"));
        }
    }
}

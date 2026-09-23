using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class Quota { public double? used { get; set; } public double? remaining { get; set; } public string reset { get; set; } }
public sealed class Account {
    public string id { get; set; } public string provider { get; set; } public string email { get; set; }
    public string label { get; set; } public string plan { get; set; } public string status { get; set; } public string message { get; set; }
    public string capturedAt { get; set; } public string checkedAt { get; set; }
    public Quota weekly { get; set; } public Quota session { get; set; } public string sessionLabel { get; set; }
}
public sealed class Snapshot { public string generatedAt { get; set; } public List<Account> accounts { get; set; } }

public sealed class WeeklyUsage : Form {
    [DllImport("user32.dll")] static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    static readonly uint showMessage = RegisterWindowMessage("WeeklyUsage.Show.2026");
    readonly string appDirectory = AppDomain.CurrentDomain.BaseDirectory;
    readonly DataGridView grid = new DataGridView();
    readonly Label footer = new Label(), detail = new Label(), summary = new Label();
    readonly Button refresh = new Button();
    readonly NotifyIcon tray = new NotifyIcon();
    readonly System.Windows.Forms.Timer schedule = new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer clock = new System.Windows.Forms.Timer();
    readonly Color ink = Color.FromArgb(29, 39, 55), accent = Color.FromArgb(35, 89, 180);
    Snapshot snapshot;
    bool busy, closing;
    string refreshError = "";
    DateTimeOffset nextRefresh;

    [STAThread] public static void Main(string[] args) {
        bool first;
        using (var mutex = new Mutex(true, "Local\\WeeklyAiUsageDashboard", out first)) {
            // The launching click owns foreground rights; pass them to the running instance.
            if (!first) { AllowSetForegroundWindow(-1); PostMessage(new IntPtr(0xffff), showMessage, IntPtr.Zero, IntPtr.Zero); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WeeklyUsage());
        }
    }

    public WeeklyUsage() {
        Text = "Weekly AI Usage";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1180, 650);
        MinimumSize = new Size(1000, 670);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10);
        ForeColor = ink;
        BackColor = Color.FromArgb(245, 247, 250);
        Icon = GaugeIcon();

        var header = new Panel { Dock = DockStyle.Top, Height = 104, Padding = new Padding(22) };
        var title = new Label { Text = "Weekly AI usage", Font = new Font("Segoe UI", 21, FontStyle.Bold),
            Location = new Point(20, 15), AutoSize = true };
        summary.SetBounds(23, 58, 720, 26);
        summary.Text = "Automatic refresh every 15 minutes.";
        summary.ForeColor = Color.FromArgb(87, 100, 119);
        refresh.Text = "Refresh now";
        refresh.SetBounds(1005, 26, 150, 38);
        refresh.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        refresh.FlatStyle = FlatStyle.Flat;
        refresh.FlatAppearance.BorderSize = 0;
        refresh.BackColor = accent;
        refresh.ForeColor = Color.White;
        refresh.Click += async delegate { await RefreshUsage(); };
        header.Controls.AddRange(new Control[] { title, summary, refresh });
        header.Resize += delegate { refresh.Left = header.ClientSize.Width - refresh.Width - 22; };

        var bottom = new Panel { Dock = DockStyle.Bottom, Height = 150 };
        detail.SetBounds(22, 13, 1136, 51);
        detail.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;
        detail.Text = "Select an account for its last reading and shorter usage window.";
        var help = new Button { Text = "Sign-in help", Location = new Point(22, 72), Size = new Size(130, 30) };
        help.Click += delegate { ShowHelp(); };
        var minimize = new Button { Text = "Minimize to tray", Location = new Point(166, 72), Size = new Size(150, 30) };
        minimize.Click += delegate { Hide(); };
        footer.SetBounds(22, 112, 1136, 26);
        footer.Anchor = AnchorStyles.Left | AnchorStyles.Bottom | AnchorStyles.Right;
        footer.ForeColor = Color.FromArgb(87, 100, 119);
        bottom.Controls.AddRange(new Control[] { detail, help, minimize, footer });

        var table = new Panel { Dock = DockStyle.Fill, Padding = new Padding(22, 0, 22, 0) };
        grid.Dock = DockStyle.Fill;
        grid.BackgroundColor = Color.White;
        grid.BorderStyle = BorderStyle.None;
        grid.AllowUserToAddRows = grid.AllowUserToDeleteRows = grid.AllowUserToResizeRows = false;
        grid.ReadOnly = true;
        grid.RowHeadersVisible = false;
        grid.MultiSelect = false;
        grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        grid.GridColor = Color.FromArgb(232, 237, 243);
        grid.EnableHeadersVisualStyles = false;
        grid.ColumnHeadersHeight = 38;
        grid.ColumnHeadersDefaultCellStyle = new DataGridViewCellStyle {
            BackColor = Color.FromArgb(235, 240, 247), ForeColor = ink,
            Font = new Font("Segoe UI", 9, FontStyle.Bold), Padding = new Padding(6, 0, 0, 0) };
        grid.DefaultCellStyle = new DataGridViewCellStyle {
            BackColor = Color.White, ForeColor = ink, SelectionBackColor = Color.FromArgb(224, 236, 252),
            SelectionForeColor = ink, Padding = new Padding(6, 0, 0, 0) };
        grid.RowTemplate.Height = 43;
        AddColumn("provider", "Provider", 70);
        AddColumn("email", "Account", 224);
        AddColumn("plan", "Plan", 127);
        AddColumn("used", "Weekly used", 114);
        AddColumn("remaining", "Remaining", 82);
        AddColumn("reset", "Resets", 151);
        AddColumn("state", "Status", 100);
        grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        grid.CellPainting += PaintUsage;
        grid.SelectionChanged += delegate { ShowDetail(); };
        table.Controls.Add(grid);
        Controls.Add(table); Controls.Add(bottom); Controls.Add(header);

        tray.Icon = Icon;
        tray.Text = "Weekly AI usage";
        tray.Visible = true;
        tray.DoubleClick += delegate { RestoreWindow(); };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Show dashboard", null, delegate { RestoreWindow(); });
        menu.Items.Add("Refresh now", null, async delegate { await RefreshUsage(); });
        menu.Items.Add("Exit", null, delegate { Close(); });
        tray.ContextMenuStrip = menu;
        Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); };
        FormClosing += delegate { closing = true; schedule.Stop(); clock.Stop(); tray.Visible = false; tray.Dispose(); };
        schedule.Interval = 15 * 60 * 1000;
        schedule.Tick += async delegate { await RefreshUsage(); };
        clock.Interval = 60000;
        clock.Tick += delegate { Render(); };
        Shown += async delegate {
            try { LoadSnapshot(File.ReadAllText(Path.Combine(appDirectory, "usage-cache.json"))); } catch { }
            clock.Start();
            await RefreshUsage();
        };
    }

    void AddColumn(string name, string title, float weight) {
        grid.Columns.Add(new DataGridViewTextBoxColumn { Name = name, HeaderText = title, FillWeight = weight,
            SortMode = DataGridViewColumnSortMode.NotSortable });
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == showMessage) RestoreWindow();
        base.WndProc(ref message);
    }
    void RestoreWindow() {
        Show(); WindowState = FormWindowState.Normal;
        // A saved position on a disconnected monitor restores off-screen; recenter on the primary screen.
        bool visible = false;
        foreach (Screen screen in Screen.AllScreens) visible |= screen.WorkingArea.IntersectsWith(Bounds);
        if (!visible) {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(Width, area.Width), Math.Min(Height, area.Height));
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
        }
        Activate(); SetForegroundWindow(Handle);
    }

    async Task RefreshUsage() {
        if (busy || closing) return;
        busy = true; refresh.Enabled = false; refresh.Text = "Refreshing...";
        schedule.Stop(); refreshError = ""; UpdateFooter();
        try {
            string json = await Task.Run(async () => {
                string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                var start = new ProcessStartInfo {
                    FileName = File.Exists(node) ? node : "node.exe",
                    Arguments = "\"" + Path.Combine(appDirectory, "collect.cjs") + "\"",
                    WorkingDirectory = appDirectory, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true };
                using (var process = Process.Start(start)) {
                    Task<string> output = process.StandardOutput.ReadToEndAsync();
                    Task<string> error = process.StandardError.ReadToEndAsync();
                    if (!process.WaitForExit(40000)) { process.Kill(); throw new Exception("Usage check timed out."); }
                    string message = (await error).Trim();
                    // Exit code 2 is a configuration problem the user must fix, so show it verbatim.
                    if (process.ExitCode == 2) throw new ArgumentException(message);
                    if (process.ExitCode != 0) throw new Exception("Usage check failed. Try Refresh now.");
                    return await output;
                }
            });
            if (!closing) LoadSnapshot(json);
        } catch (ArgumentException e) {
            if (!closing) refreshError = e.Message;
        } catch (Exception) {
            if (!closing) refreshError = "Refresh failed. Last readings may be stale. Try Refresh now.";
        } finally {
            busy = false;
            if (!closing) {
                refresh.Enabled = true; refresh.Text = "Refresh now";
                nextRefresh = DateTimeOffset.UtcNow.AddMinutes(15);
                schedule.Start(); Render();
            }
        }
    }
    void LoadSnapshot(string json) {
        var data = new JavaScriptSerializer().Deserialize<Snapshot>(json);
        if (data == null || data.accounts == null || data.accounts.Count == 0) throw new Exception("Invalid snapshot.");
        snapshot = data; Render();
    }
    static bool IsPast(string value) {
        DateTimeOffset date;
        return DateTimeOffset.TryParse(value, out date) && date <= DateTimeOffset.UtcNow;
    }
    string State(Account a) {
        if (a.weekly != null && IsPast(a.weekly.reset)) return "Reset pending";
        DateTimeOffset captured;
        if (a.status == "Live" && (refreshError.Length > 0 || !DateTimeOffset.TryParse(a.capturedAt, out captured) ||
            DateTimeOffset.UtcNow - captured > TimeSpan.FromMinutes(20))) return "Stale";
        return a.status;
    }
    static string Pct(double? value) { return value.HasValue ? value.Value.ToString("0.#", CultureInfo.InvariantCulture) + "%" : "Unavailable"; }
    static string Local(string value) {
        DateTimeOffset date;
        return DateTimeOffset.TryParse(value, out date) ? date.ToLocalTime().ToString("ddd dd MMM HH:mm", CultureInfo.InvariantCulture) : "Not supplied";
    }
    void Render() {
        if (closing) return;
        if (snapshot == null) { UpdateFooter(); return; }
        string selected = grid.CurrentRow == null ? null : ((Account)grid.CurrentRow.Tag).id;
        grid.Rows.Clear(); int live = 0;
        foreach (Account a in snapshot.accounts) {
            string state = State(a); bool past = state == "Reset pending";
            if (state == "Live") live++;
            int index = grid.Rows.Add(CultureInfo.InvariantCulture.TextInfo.ToTitleCase(a.provider), string.IsNullOrEmpty(a.label) ? a.email : a.label + " (" + a.email + ")",
                a.plan == "pro" ? "Pro" : a.plan, Pct(past || a.weekly == null ? null : a.weekly.used),
                Pct(past || a.weekly == null ? null : a.weekly.remaining), Local(a.weekly == null ? null : a.weekly.reset), state);
            grid.Rows[index].Tag = a;
            grid.Rows[index].Cells[6].Style.ForeColor = state == "Live" ? Color.FromArgb(30, 110, 75) : Color.FromArgb(151, 86, 21);
            grid.Rows[index].Cells[6].ToolTipText = a.message;
            if (a.id == selected) grid.CurrentCell = grid.Rows[index].Cells[0];
        }
        summary.Text = live + " of " + snapshot.accounts.Count + " accounts live. Automatic refresh every 15 minutes.";
        ShowDetail(); UpdateFooter();
    }
    void ShowDetail() {
        if (grid.CurrentRow == null || grid.CurrentRow.Tag == null) return;
        var a = (Account)grid.CurrentRow.Tag;
        string shortWindow = a.session != null && a.session.used.HasValue && !IsPast(a.session.reset)
            ? a.sessionLabel + ": " + Pct(a.session.used) + " used. Resets " + Local(a.session.reset) + ".  " : "";
        detail.Text = shortWindow + "Last reading: " + (a.capturedAt == null ? "none" : Local(a.capturedAt)) +
            Environment.NewLine + (string.IsNullOrEmpty(a.message) ? "Account quota includes usage reported by the provider." : a.message);
    }
    void UpdateFooter() {
        if (closing) return;
        long memory = Process.GetCurrentProcess().WorkingSet64 / (1024 * 1024);
        footer.Text = refreshError.Length > 0 ? refreshError : busy ? "Reading account usage..." :
            "Next refresh: " + nextRefresh.ToLocalTime().ToString("HH:mm") + "   |   Dashboard RAM: " + memory +
            " MB   |   Closing this window exits. Minimize keeps automatic refresh active.";
    }
    void ShowHelp() {
        var a = grid.CurrentRow == null ? null : grid.CurrentRow.Tag as Account;
        string command = a == null ? "Open the account's normal CLI." :
            a.provider == "grok" ? "Run grok login with " + a.email + "." :
            a.provider == "devin" ? "Run devin auth login with " + a.email + "." :
            "Open " + a.provider + " with this account's config folder (CLAUDE_CONFIG_DIR or CODEX_HOME) and run /usage. If asked to sign in, use " + a.email + ".";
        MessageBox.Show(this, command + Environment.NewLine + Environment.NewLine +
            "Then click Refresh now. The dashboard reads existing logins and never switches your active account or changes credentials.",
            "Account sign-in", MessageBoxButtons.OK, MessageBoxIcon.None);
    }
    void PaintUsage(object sender, DataGridViewCellPaintingEventArgs e) {
        if (e.RowIndex < 0 || e.ColumnIndex != 3) return;
        var a = grid.Rows[e.RowIndex].Tag as Account;
        if (a == null || a.weekly == null || !a.weekly.used.HasValue || State(a) == "Reset pending") return;
        e.PaintBackground(e.ClipBounds, true);
        var rect = new Rectangle(e.CellBounds.X + 8, e.CellBounds.Y + 12, e.CellBounds.Width - 17, e.CellBounds.Height - 24);
        using (var track = new SolidBrush(Color.FromArgb(232, 237, 243))) e.Graphics.FillRectangle(track, rect);
        Color color = State(a) == "Stale" ? Color.FromArgb(202, 208, 216) : a.weekly.used >= 90 ? Color.FromArgb(248, 197, 189) :
            a.weekly.used >= 70 ? Color.FromArgb(250, 221, 165) : Color.FromArgb(187, 220, 242);
        using (var fill = new SolidBrush(color)) e.Graphics.FillRectangle(fill, rect.X, rect.Y,
            (float)(rect.Width * a.weekly.used.Value / 100), rect.Height);
        TextRenderer.DrawText(e.Graphics, Pct(a.weekly.used), grid.Font, e.CellBounds, ink,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        e.Handled = true;
    }
    static Icon GaugeIcon() {
        // Lucide gauge geometry, ISC license. Native rendering avoids an image dependency.
        using (var bitmap = new Bitmap(32, 32)) {
            using (var g = Graphics.FromImage(bitmap)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.ScaleTransform(32f / 24, 32f / 24);
                using (var pen = new Pen(Color.FromArgb(35, 89, 180), 2)) {
                    pen.StartCap = pen.EndCap = LineCap.Round;
                    g.DrawArc(pen, 2, 2, 20, 20, 135, 270);
                    g.DrawLine(pen, 12, 12, 16, 8);
                }
            }
            IntPtr handle = bitmap.GetHicon();
            try { using (var icon = Icon.FromHandle(handle)) return (Icon)icon.Clone(); }
            finally { DestroyIcon(handle); }
        }
    }
}

using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

public sealed class AccountSetupForm : Form {
    readonly AccountConfiguration configuration;
    readonly ListBox accounts = new ListBox();
    readonly ComboBox provider = new ComboBox();
    readonly TextBox email = new TextBox(), label = new TextBox(), home = new TextBox(), cli = new TextBox();
    readonly Label feedback = new Label(), profileLabel = new Label(), cliLabel = new Label();
    readonly Button find = new Button(), browseHome = new Button(), browseCli = new Button(), remove = new Button();
    bool loading;

    public AccountSetupForm(string path) {
        configuration = AccountConfiguration.Open(path);
        Text = "Manage accounts";
        Font = new Font("Segoe UI", 10);
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(740, 620);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = MinimizeBox = false;
        ShowInTaskbar = false;
        BackColor = Color.FromArgb(245, 247, 250);

        Controls.Add(new Label { Text = "Start with one account", AutoSize = true,
            Font = new Font(Font.FontFamily, 18, FontStyle.Bold), Location = new Point(20, 18) });
        Controls.Add(new Label { Text = "Use a CLI login you already have. No passwords or API keys are needed here.",
            Location = new Point(22, 62), Size = new Size(695, 44) });
        accounts.SetBounds(22, 114, 200, 342);
        accounts.AccessibleName = "Configured accounts";
        accounts.SelectedIndexChanged += delegate { LoadSelected(); };
        Controls.Add(accounts);
        var add = new Button { Text = "New account", Location = new Point(22, 468), Size = new Size(200, 32) };
        add.Click += delegate { accounts.ClearSelected(); LoadSelected(); provider.Focus(); };
        Controls.Add(add);
        remove.Text = "Remove account"; remove.SetBounds(22, 510, 200, 32);
        remove.Click += delegate { RemoveAccount(); };
        Controls.Add(remove);

        Controls.Add(new Label { Text = "Provider", Location = new Point(248, 114), AutoSize = true });
        provider.SetBounds(248, 140, 465, 28);
        provider.DropDownStyle = ComboBoxStyle.DropDownList;
        provider.Items.AddRange(new object[] { "Claude", "Codex", "Grok", "Devin" });
        provider.AccessibleName = "Provider";
        provider.SelectedIndexChanged += delegate {
            if (!loading) { home.Clear(); cli.Clear(); email.Clear(); feedback.Text = ""; }
            SetProviderControls();
        };
        Controls.Add(provider);
        AddField("Account email", email, 182);
        AddField("Label (optional)", label, 246);
        profileLabel.Text = "Profile folder (optional)";
        profileLabel.SetBounds(248, 310, 450, 24); Controls.Add(profileLabel);
        home.SetBounds(248, 336, 357, 28); home.AccessibleName = "Profile folder"; Controls.Add(home);
        browseHome.Text = "Browse..."; browseHome.SetBounds(615, 333, 98, 32);
        browseHome.Click += delegate {
            using (var picker = new FolderBrowserDialog { Description = "Choose this account's CLI config folder", ShowNewFolderButton = false }) {
                if (Directory.Exists(home.Text)) picker.SelectedPath = home.Text;
                if (picker.ShowDialog(this) == DialogResult.OK) home.Text = picker.SelectedPath;
            }
        };
        Controls.Add(browseHome);
        cliLabel.Text = "Devin CLI path (optional)";
        cliLabel.SetBounds(248, 310, 450, 24); Controls.Add(cliLabel);
        cli.SetBounds(248, 336, 357, 28); cli.AccessibleName = "Devin CLI path"; Controls.Add(cli);
        browseCli.Text = "Browse..."; browseCli.SetBounds(615, 333, 98, 32);
        browseCli.Click += delegate {
            using (var picker = new OpenFileDialog { Title = "Choose devin.exe", Filter = "Executable files (*.exe)|*.exe", CheckFileExists = true })
                if (picker.ShowDialog(this) == DialogResult.OK) cli.Text = picker.FileName;
        };
        Controls.Add(browseCli);
        find.Text = "Find existing login"; find.SetBounds(248, 383, 194, 34);
        find.Click += delegate { FindLogin(); };
        Controls.Add(find);
        feedback.SetBounds(248, 432, 465, 106);
        feedback.AccessibleName = "Account setup status";
        feedback.ForeColor = Color.FromArgb(65, 80, 99);
        Controls.Add(feedback);

        var save = new Button { Text = "Save account", Location = new Point(447, 564), Size = new Size(140, 34) };
        save.Click += delegate { SaveAccount(); };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel,
            Location = new Point(599, 564), Size = new Size(114, 34) };
        Controls.Add(save); Controls.Add(cancel);
        AcceptButton = save; CancelButton = cancel;
        foreach (var account in configuration.Accounts)
            accounts.Items.Add(account.provider + " - " + (string.IsNullOrEmpty(account.label) ? account.email : account.label));
        if (accounts.Items.Count > 0) accounts.SelectedIndex = 0;
        else LoadSelected();
    }

    void AddField(string title, TextBox field, int top) {
        Controls.Add(new Label { Text = title, Location = new Point(248, top), AutoSize = true });
        field.SetBounds(248, top + 26, 465, 28); field.AccessibleName = title;
        Controls.Add(field);
    }
    string Provider { get { return provider.Text.ToLowerInvariant(); } }
    void LoadSelected() {
        loading = true;
        var account = accounts.SelectedIndex < 0 ? null : configuration.Accounts[accounts.SelectedIndex];
        provider.SelectedIndex = account == null ? 0 : provider.FindStringExact(account.provider);
        email.Text = account == null ? "" : account.email;
        label.Text = account == null ? "" : account.label;
        home.Text = account == null ? "" : account.home;
        cli.Text = account == null ? "" : account.cli;
        remove.Enabled = account != null;
        loading = false;
        feedback.Text = "";
        SetProviderControls();
    }
    void SetProviderControls() {
        bool devin = Provider == "devin";
        home.Visible = profileLabel.Visible = browseHome.Visible = !devin;
        cli.Visible = cliLabel.Visible = browseCli.Visible = devin;
        find.Enabled = !devin;
        feedback.Text = devin ? "Enter the email used by your Devin CLI login. Leave the CLI path blank if devin is on PATH." :
            "Leave the folder blank for the default profile. Find existing login reads its local identity; Save account checks quota.";
    }
    void FindLogin() {
        try {
            string detected = AccountConfiguration.DetectEmail(Provider, home.Text.Trim());
            if (string.IsNullOrEmpty(detected)) {
                feedback.Text = "No single login identity found. Choose the correct profile folder, or enter the email you use in that CLI. Sign-in help is available after saving.";
            } else {
                email.Text = detected;
                feedback.Text = "Found a local login identity. Save account to check whether its quota is available.";
            }
        } catch (Exception e) { feedback.Text = "Could not read that profile: " + e.Message; }
    }
    void SaveAccount() {
        int selected = accounts.SelectedIndex;
        var account = selected < 0 ? new AccountSettings() : configuration.Accounts[selected];
        string oldProvider = account.provider, oldEmail = account.email, oldLabel = account.label, oldHome = account.home, oldCli = account.cli;
        account.provider = Provider; account.email = email.Text.Trim(); account.label = label.Text.Trim();
        account.home = Provider == "devin" ? "" : home.Text.Trim();
        account.cli = Provider == "devin" ? cli.Text.Trim() : "";
        if (selected < 0) configuration.Accounts.Add(account);
        try {
            configuration.Save();
            DialogResult = DialogResult.OK; Close();
        } catch (Exception e) {
            if (selected < 0) configuration.Accounts.Remove(account);
            else { account.provider = oldProvider; account.email = oldEmail; account.label = oldLabel; account.home = oldHome; account.cli = oldCli; }
            feedback.Text = e.Message;
        }
    }
    void RemoveAccount() {
        int index = accounts.SelectedIndex;
        if (index < 0 || MessageBox.Show(this, "Remove this account from the dashboard? Its CLI login will stay unchanged.",
            "Remove account", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        var account = configuration.Accounts[index];
        configuration.Accounts.RemoveAt(index);
        try { configuration.Save(); DialogResult = DialogResult.OK; Close(); }
        catch (Exception e) { configuration.Accounts.Insert(index, account); feedback.Text = e.Message; }
    }
}

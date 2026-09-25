#ifndef AppVersion
  #error AppVersion is required. Run installer.ps1.
#endif
#ifndef AppNumericVersion
  #error AppNumericVersion is required. Run installer.ps1.
#endif
#ifndef SourceDirectory
  #error SourceDirectory is required. Run installer.ps1.
#endif
#ifndef OutputDirectory
  #error OutputDirectory is required. Run installer.ps1.
#endif

[Setup]
AppId={{BCD80182-BC56-4F3D-9608-14E0F73C8493}
AppName=Weekly AI Usage
AppVersion={#AppVersion}
AppPublisher=Naim Katiman
AppPublisherURL=https://github.com/naimkatiman/weekly-ai-usage
AppSupportURL=https://github.com/naimkatiman/weekly-ai-usage/issues
VersionInfoVersion={#AppNumericVersion}
DefaultDirName={localappdata}\Programs\Weekly AI Usage
DefaultGroupName=Weekly AI Usage
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SourceDir={#SourceDirectory}
OutputDir={#OutputDirectory}
OutputBaseFilename=WeeklyAIUsage-{#AppVersion}-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
UninstallDisplayIcon={app}\WeeklyUsage.exe
CloseApplications=yes
CloseApplicationsFilter=WeeklyUsage.exe,node.exe
RestartApplications=no

[Files]
; Only public runtime files are installed. Application-created accounts.json and
; usage-cache.json stay outside the uninstall log and survive upgrades/removal.
Source: "WeeklyUsage.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "collect.cjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "grok.cjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "devin.cjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "accounts.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "docs\troubleshooting.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "docs\onboarding.png"; DestDir: "{app}\docs"; Flags: ignoreversion
#if FileExists(SourceDirectory + "\docs\screenshot.png")
Source: "docs\screenshot.png"; DestDir: "{app}\docs"; Flags: ignoreversion
#endif
Source: "runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "runtime\LICENSE"; DestDir: "{app}\runtime"; Flags: ignoreversion

[Icons]
Name: "{group}\Weekly AI Usage"; Filename: "{app}\WeeklyUsage.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\WeeklyUsage.exe"; WorkingDir: "{app}"; Description: "Open Weekly AI Usage"; Flags: postinstall nowait skipifsilent

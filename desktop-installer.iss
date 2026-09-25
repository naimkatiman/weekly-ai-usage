#ifndef AppVersion
  #error AppVersion is required. Run npm run package:desktop.
#endif
#ifndef AppNumericVersion
  #error AppNumericVersion is required.
#endif
#ifndef SourceDirectory
  #error SourceDirectory is required.
#endif
#ifndef OutputDirectory
  #error OutputDirectory is required.
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
CloseApplicationsFilter=WeeklyUsage.exe
RestartApplications=no

[Files]
; SourceDirectory is the allowlisted, privacy-scanned Electron output, never the
; repository or an existing installation. Inno logs only these program files.
; Existing accounts.json/cache files and Electron userData remain unlogged.
Source: "*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Weekly AI Usage"; Filename: "{app}\WeeklyUsage.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\WeeklyUsage.exe"; WorkingDir: "{app}"; Description: "Open Weekly AI Usage"; Flags: postinstall nowait skipifsilent

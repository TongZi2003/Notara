# WScript.Shell stores shortcut filenames through the active ANSI code page.
# Use the explicit Unicode shell interface for both ownership checks and saves.
# https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
# https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-ipersistfile-save

if (-not ('Notara.Windows.ShortcutFile' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Notara.Windows {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046"), ClassInterface(ClassInterfaceType.None)]
    internal class ShellLink { }

    // Method order is the complete IShellLinkW vtable following IUnknown.
    // void return values preserve COM HRESULT exception handling by the CLR.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int count);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int count);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int count);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out ushort hotkey);
        void SetHotkey(ushort hotkey);
        void GetShowCmd(out int showCmd);
        void SetShowCmd(int showCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int count, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class ShortcutInfo {
        public string TargetPath { get; set; }
        public string Arguments { get; set; }
        public string WorkingDirectory { get; set; }
        public string Description { get; set; }
        public string IconLocation { get; set; }
        public int WindowStyle { get; set; }
    }

    public static class ShortcutFile {
        public static ShortcutInfo Read(string path) {
            object value = new ShellLink();
            try {
                ((IPersistFile)value).Load(Path.GetFullPath(path), 0);
                IShellLinkW link = (IShellLinkW)value;
                StringBuilder target = new StringBuilder(32768);
                StringBuilder arguments = new StringBuilder(32768);
                StringBuilder directory = new StringBuilder(32768);
                StringBuilder description = new StringBuilder(32768);
                StringBuilder icon = new StringBuilder(32768);
                int iconIndex, windowStyle;
                // SLGP_RAWPATH: read the stored path without resolving or opening
                // its target. NULL findData requests no target filesystem lookup.
                link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
                link.GetArguments(arguments, arguments.Capacity);
                link.GetWorkingDirectory(directory, directory.Capacity);
                link.GetDescription(description, description.Capacity);
                link.GetIconLocation(icon, icon.Capacity, out iconIndex);
                link.GetShowCmd(out windowStyle);
                return new ShortcutInfo {
                    TargetPath = target.ToString(), Arguments = arguments.ToString(),
                    WorkingDirectory = directory.ToString(), Description = description.ToString(),
                    IconLocation = icon.Length == 0 ? "" : icon.ToString() + "," + iconIndex.ToString(CultureInfo.InvariantCulture),
                    WindowStyle = windowStyle
                };
            } finally { Marshal.FinalReleaseComObject(value); }
        }

        public static void Write(string path, string targetPath, string arguments, string workingDirectory,
                                 string description, string iconLocation, int windowStyle) {
            object value = new ShellLink();
            try {
                IShellLinkW link = (IShellLinkW)value;
                link.SetPath(targetPath);
                link.SetArguments(arguments ?? "");
                link.SetWorkingDirectory(workingDirectory ?? "");
                link.SetDescription(description ?? "");
                link.SetShowCmd(windowStyle);
                if (!String.IsNullOrEmpty(iconLocation)) {
                    string iconPath = iconLocation;
                    int iconIndex = 0, parsedIndex;
                    int separator = iconLocation.LastIndexOf(',');
                    if (separator >= 0 && Int32.TryParse(iconLocation.Substring(separator + 1),
                            NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedIndex)) {
                        iconPath = iconLocation.Substring(0, separator);
                        iconIndex = parsedIndex;
                    }
                    if (iconPath.Length == 0) throw new ArgumentException("Icon path must not be empty.", "iconLocation");
                    link.SetIconLocation(iconPath, iconIndex);
                }
                ((IPersistFile)value).Save(Path.GetFullPath(path), true);
            } finally { Marshal.FinalReleaseComObject(value); }
        }
    }
}
'@ -ErrorAction Stop | Out-Null
}

function Read-NotaraShortcut {
    param([Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Path)
    return [Notara.Windows.ShortcutFile]::Read($Path)
}

function Write-NotaraShortcut {
    param(
        [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Path,
        [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$TargetPath,
        [AllowEmptyString()][string]$Arguments = '',
        [AllowEmptyString()][string]$WorkingDirectory = '',
        [AllowEmptyString()][string]$Description = '',
        [AllowEmptyString()][string]$IconLocation = '',
        [int]$WindowStyle = 7
    )
    [Notara.Windows.ShortcutFile]::Write($Path, $TargetPath, $Arguments, $WorkingDirectory, $Description, $IconLocation, $WindowStyle)
}

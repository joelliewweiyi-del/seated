' Runs a command without a console window. Used by the Windows scheduled tasks in windows-autostart.ps1.
'   wscript.exe scripts\windows-hidden.vbs "<command line>"
CreateObject("WScript.Shell").Run WScript.Arguments(0), 0, True

' Runs a command without a console window. Used by the Windows scheduled tasks in windows-autostart.ps1.
'   wscript.exe scripts\windows-hidden.vbs <program> <arguments...>
' Pass the program and each argument separately: wscript cannot read a whole command line with nested quotes.
Dim i, a, cmd
For i = 0 To WScript.Arguments.Count - 1
  a = WScript.Arguments(i)
  If InStr(a, " ") > 0 Then a = """" & a & """"
  cmd = cmd & a & " "
Next
CreateObject("WScript.Shell").Run cmd, 0, True

' Run a Atrium script with no console window at all.
'
' WHY THIS EXISTS. The watchdog task ran a .cmd file directly, every five
' minutes, in the interactive session -- so Windows opened a console window
' every five minutes, all day. On a machine somebody games on, that is an
' alt-tab out of a fullscreen game twelve times an hour, which is how a
' watchdog ends up switched off. The backup task had the same shape once a
' night.
'
' Things that do NOT solve it:
'   cmd /c ...                     always creates a console in an interactive
'                                  task, whatever is inside it.
'   powershell -WindowStyle Hidden creates the console host and hides it a
'                                  moment later -- a visible flash, and it can
'                                  still steal focus from fullscreen.
'   schtasks /RU SYSTEM            runs in session 0 with no window at all and
'                                  is the right answer, but creating it needs
'                                  an elevated shell.
'
' WScript.Shell's Run() takes a window style, so the process is created hidden
' rather than shown and then hidden. Nothing ever appears.
'
' The same shim guards the JacksRP database backup on this machine, for the
' same reason and after the same false starts.
'
' VBScript is deprecated on Windows 11. It works today and is the standard way
' to do this without administrator rights, but if these tasks ever stop firing,
' this is the first thing to suspect - not a silently broken server. The fix
' then is to grant the tasks SYSTEM from an elevated shell.

Option Explicit

Dim shell, args, command, i, first, wait, exitCode

Set shell = CreateObject("WScript.Shell")
Set args = WScript.Arguments

If args.Count = 0 Then
  WScript.Quit 2
End If

' /nowait: start it and return, rather than waiting for it to finish.
'
' Waiting is right for work that ends - a backup, a health check. It is wrong
' for starting a server, and the watchdog does exactly that. Waiting there
' meant the watchdog process lived for as long as the server it had just
' started, and the task's own "do not start a second copy" policy then skipped
' every check after it. So the watchdog would restart the server once and never
' look again - a watchdog that switches itself off the first time it is needed.
first = 0
wait = True
If LCase(args(0)) = "/nowait" Then
  first = 1
  wait = False
End If

If args.Count <= first Then
  WScript.Quit 2
End If

' Quote every part: these are paths, and this machine has one with a space in
' it somewhere sooner or later.
command = ""
For i = first To args.Count - 1
  If i > first Then command = command & " "
  command = command & """" & args(i) & """"
Next

' 0 = hidden, so nothing ever appears on screen.
exitCode = shell.Run(command, 0, wait)

WScript.Quit exitCode

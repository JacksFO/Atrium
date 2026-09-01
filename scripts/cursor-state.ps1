<#
  Is Windows itself hiding the cursor right now?

  Asked because of a screen share of Tarkov: the person watching could see a
  pointer sitting in the middle of the picture and the person playing could
  not see one at all. Chromium draws a cursor into a screen capture whatever
  it is told - proven, the constraint is not even a supported one - so the
  only route to "no cursor while running around, a cursor in the inventory"
  is to drive the capture from what the system says.

  Which only works if the system says anything useful. A game can hide the
  pointer in two ways: ask Windows to hide it, which this sees, or keep it
  and draw nothing, which this cannot tell from a normal pointer. This says
  which of those a given game does.

  Run it, then play for a minute and open your inventory a few times. It
  prints a line only when the answer changes.
#>
param([int]$Seconds = 120)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CursorPeek {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@

function Read-Cursor {
  $ci = New-Object CursorPeek+CURSORINFO
  $ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($ci)
  $null = [CursorPeek]::GetCursorInfo([ref]$ci)
  # flags: 0 = hidden, 1 = showing, 2 = suppressed (touch). The handle matters
  # too - a game that "hides" the pointer by using a blank one still shows a
  # cursor, and only the handle changing gives that away.
  [PSCustomObject]@{ Flags = $ci.flags; Handle = $ci.hCursor; X = $ci.pt.x; Y = $ci.pt.y }
}

function Read-Window {
  $sb = New-Object System.Text.StringBuilder 256
  $null = [CursorPeek]::GetWindowText([CursorPeek]::GetForegroundWindow(), $sb, 256)
  $sb.ToString()
}

Write-Output "watching for $Seconds seconds - play, and open your inventory a few times"
Write-Output "flags: 1 = Windows says a cursor is showing, 0 = hidden, 2 = suppressed"
Write-Output ""

$last = $null
$stop = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $stop) {
  $c = Read-Cursor
  $key = "$($c.Flags)/$($c.Handle)"
  if ($key -ne $last) {
    $last = $key
    $when = (Get-Date).ToString("HH:mm:ss")
    $what = if ($c.Flags -eq 1) { "SHOWING" } elseif ($c.Flags -eq 0) { "hidden " } else { "suppressed" }
    Write-Output ("{0}  {1}  shape={2}  at {3},{4}  [{5}]" -f $when, $what, $c.Handle, $c.X, $c.Y, (Read-Window))
  }
  Start-Sleep -Milliseconds 250
}
Write-Output ""
Write-Output "done"

; Remove the app under the name it had before.
;
; Changing appId means Windows no longer recognises the previous install as
; this application, so it sits alongside the new one: two entries in Apps &
; Features, two Start Menu shortcuts, two folders.
;
; Found by its name, not by its identifier. The first attempt looked up
; HKCU\...\Uninstall\dev.jacksfo.jackscord, which does not exist: the key is a
; GUID that electron-builder derives from the appId, so the lookup quietly
; found nothing and the old app stayed exactly where it was. The derivation is
; not something to guess at from here, and a value copied off one machine is a
; value nobody can check, so this reads the DisplayName of each entry instead
; and matches the one that begins with JacksCord.
;
; Per user first, which is where a one-click installer registers, then per
; machine in case a copy was ever installed that way.

!macro RemoveOldApp ROOT
  StrCpy $R4 0
  ${Do}
    EnumRegKey $R5 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R4
    ${If} $R5 == ""
      ${Break}
    ${EndIf}

    ReadRegStr $R6 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R5" "DisplayName"
    StrCpy $R7 $R6 9
    ${If} $R7 == "JacksCord"
      ReadRegStr $R8 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R5" "QuietUninstallString"
      ${If} $R8 != ""
        DetailPrint "Removing $R6..."
        ; The stored string carries its own silent flags.
        ExecWait '$R8'
      ${EndIf}
    ${EndIf}

    IntOp $R4 $R4 + 1
  ${Loop}
!macroend

!macro customInit
  !insertmacro RemoveOldApp HKCU
  !insertmacro RemoveOldApp HKLM
!macroend

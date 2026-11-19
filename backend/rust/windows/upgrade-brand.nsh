!define JUJUBA_OLD_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\JujubaSQL"
Var JujubaLegacyDir

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "${MANUKEY}\JujubaSQL" ""
  ReadRegStr $1 HKCU "${JUJUBA_OLD_UNINSTALL}" "MainBinaryName"
  ReadRegStr $2 HKCU "${JUJUBA_OLD_UNINSTALL}" "UninstallString"
  ReadRegStr $3 HKCU "${JUJUBA_OLD_UNINSTALL}" "Publisher"
  ${If} $0 != ""
  ${AndIf} $1 == "${MAINBINARYNAME}.exe"
  ${AndIf} $2 == '$\"$0\uninstall.exe$\"'
  ${AndIf} $3 == "${MANUFACTURER}"
  ${AndIf} ${FileExists} "$0\$1"
    ${If} $INSTDIR == "$0"
    ${OrIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
      ; Reuse the registered installation so pinned shortcuts and the updater still reach the same executable.
      ReadRegStr $1 HKCU "${MANUPRODUCTKEY}" ""
      ${If} $1 == ""
        StrCpy $JujubaLegacyDir $0
        StrCpy $INSTDIR $0
        SetOutPath "$INSTDIR"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro JujubaRenameShortcut FOLDER
  !insertmacro IsShortcutTarget "${FOLDER}\JujubaSQL.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 == 1
    ${If} ${FileExists} "${FOLDER}\${PRODUCTNAME}.lnk"
      !insertmacro IsShortcutTarget "${FOLDER}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 == 1
        Delete "${FOLDER}\JujubaSQL.lnk"
      ${EndIf}
    ${Else}
      Rename "${FOLDER}\JujubaSQL.lnk" "${FOLDER}\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $JujubaLegacyDir != ""
    !insertmacro JujubaRenameShortcut "$DESKTOP"
    !insertmacro JujubaRenameShortcut "$SMPROGRAMS"
    DeleteRegKey HKCU "${JUJUBA_OLD_UNINSTALL}"
    DeleteRegKey HKCU "${MANUKEY}\JujubaSQL"
  ${EndIf}
!macroend

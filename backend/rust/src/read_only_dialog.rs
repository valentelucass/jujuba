use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetAncestor, GetClassNameW, GetDlgCtrlID, GetMenu, GetParent, GetWindow,
    GetWindowLongW, GetWindowThreadProcessId, IsWindowVisible, LoadIconW, SendMessageTimeoutW,
    BS_DEFPUSHBUTTON, BS_PUSHBUTTON, BS_TYPEMASK, GA_ROOT, GWL_STYLE, GW_OWNER, IDCANCEL,
    IDI_INFORMATION, IDOK, SMTO_ABORTIFHUNG, SMTO_ERRORONEXIT, STM_GETICON, WM_GETTEXT,
    WS_DISABLED,
};

struct Controls {
    dialog: HWND,
    pid: u32,
    valid: bool,
    button: bool,
    text: bool,
    info_icon: usize,
    icon_seen: bool,
}

fn class(window: HWND, expected: &str) -> bool {
    let mut name = [0u16; 32];
    let length = unsafe { GetClassNameW(window, name.as_mut_ptr(), name.len() as i32) };
    length > 0
        && name[..length as usize]
            .iter()
            .copied()
            .eq(expected.encode_utf16())
}

fn message(window: HWND, msg: u32, wparam: usize, lparam: isize) -> Option<usize> {
    let mut result = 0;
    let success = unsafe {
        SendMessageTimeoutW(
            window,
            msg,
            wparam,
            lparam,
            SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT,
            100,
            &mut result,
        )
    };
    (success != 0).then_some(result)
}

impl Controls {
    fn accept(&mut self, window: HWND) -> bool {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        if pid != self.pid || unsafe { GetParent(window) } != self.dialog {
            return false;
        }
        let style = unsafe { GetWindowLongW(window, GWL_STYLE) };
        if class(window, "Static") {
            // SS_LEFT, SS_CENTER, SS_RIGHT, SS_SIMPLE, SS_LEFTNOWORDWRAP display text.
            // Owner-drawn controls, inputs, bitmaps and arbitrary custom controls are excluded.
            return match style & 0x1f {
                0 | 1 | 2 | 11 | 12 => {
                    self.text = true;
                    true
                }
                3 => {
                    // SS_ICON
                    let icon = message(window, STM_GETICON, 0, 0);
                    if icon != Some(self.info_icon) {
                        return false;
                    }
                    self.icon_seen = true;
                    true
                }
                _ => false,
            };
        }
        if !class(window, "Button")
            || self.button
            || !matches!(unsafe { GetDlgCtrlID(window) }, IDOK | IDCANCEL)
            || !matches!(style & BS_TYPEMASK, BS_PUSHBUTTON | BS_DEFPUSHBUTTON)
            || unsafe { IsWindowVisible(window) } == 0
            || style as u32 & WS_DISABLED != 0
        {
            return false;
        }
        // A native MB_OK uses IDCANCEL on some builds so Esc dismisses its only button.
        // Only read the standard acknowledgement button. Never inspect the notice body.
        let mut label = [0u16; 12];
        let Some(n) = message(window, WM_GETTEXT, label.len(), label.as_mut_ptr() as isize) else {
            return false;
        };
        if n >= label.len()
            || !matches!(
                String::from_utf16_lossy(&label[..n]).as_str(),
                "OK" | "&OK" | "O&K"
            )
        {
            return false;
        }
        self.button = true;
        true
    }
}

pub(crate) fn is_informational(window: HWND) -> bool {
    if window.is_null()
        || !class(window, "#32770")
        || unsafe {
            GetAncestor(window, GA_ROOT) != window
                || !GetWindow(window, GW_OWNER).is_null()
                || !GetMenu(window).is_null()
        }
    {
        return false;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    let info_icon = unsafe { LoadIconW(null_mut(), IDI_INFORMATION) } as usize;
    if pid == 0 || info_icon == 0 {
        return false;
    }
    unsafe extern "system" fn visit(child: HWND, data: LPARAM) -> i32 {
        let state = &mut *(data as *mut Controls);
        state.valid = state.accept(child);
        i32::from(state.valid)
    }
    let mut state = Controls {
        dialog: window,
        pid,
        valid: true,
        button: false,
        text: false,
        info_icon,
        icon_seen: false,
    };
    unsafe { EnumChildWindows(window, Some(visit), &mut state as *mut _ as LPARAM) };
    state.valid && state.button && state.text && state.icon_seen
}

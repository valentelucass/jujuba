use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, Window};

// Compute each axis in physical pixels so DPI and taskbars use the same coordinate system.
fn fit_axis(desired: u32, frame: u32, work_origin: i32, work_length: u32) -> (u32, i32) {
    let inner = desired.min(work_length.saturating_sub(frame + 24)).max(1);
    let offset = work_length.saturating_sub(inner + frame) / 2;
    (inner, work_origin + offset as i32)
}

/// Fit the measured Windows frame, including the title bar and DPI-dependent borders.
pub fn fit_main_window(window: &Window) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let work = monitor.work_area();
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let frame_width = outer.width.saturating_sub(inner.width);
    let frame_height = outer.height.saturating_sub(inner.height);
    let (width, left) = fit_axis(inner.width, frame_width, work.position.x, work.size.width);
    let (height, top) = fit_axis(inner.height, frame_height, work.position.y, work.size.height);
    let fitted = PhysicalSize::new(width, height);
    if inner != fitted {
        window.set_size(fitted)?;
    }
    let min = LogicalSize::new(880.0, 610.0).to_physical::<u32>(monitor.scale_factor());
    window.set_min_size(Some(PhysicalSize::new(min.width.min(width), min.height.min(height))))?;
    window.set_position(PhysicalPosition::new(left, top))
}

#[cfg(test)]
mod tests {
    use super::fit_axis;

    #[test]
    fn centers_outer_frame_and_keeps_taskbar_space_on_small_or_offset_monitors() {
        assert_eq!(fit_axis(1380, 16, 0, 1920), (1380, 262));
        assert_eq!(fit_axis(850, 39, 0, 728), (665, 12));
        assert_eq!(fit_axis(1275, 58, 72, 1008), (926, 84));
        assert_eq!(fit_axis(1725, 20, -1600, 1600), (1556, -1588));
    }
}

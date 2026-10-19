// Без консольного окна в релизной сборке Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--setup` — подготовка компьютера из установщика, без окна.
    if let Some(code) = openplane_studio_lib::cli() {
        std::process::exit(code);
    }
    openplane_studio_lib::run()
}

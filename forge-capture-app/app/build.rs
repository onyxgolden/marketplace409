fn main() {
    tauri_build::build();
    // Bake the source revision into the binary for the capture worker's
    // phase log (build identity). Best effort: "unknown" when git is
    // unavailable (e.g. packaged sources).
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=FORGE_BUILD_GIT_SHA={sha}");
}

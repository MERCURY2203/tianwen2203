# 迟叙机 · 安卓外壳

用系统 WebView 打开打包在 App 里的迟叙机（纯前端版）。网页文件在 `app/src/main/assets/`，
由 `node web/build.mjs --app` 生成（测试版，不需要卡密）。

- 推送到 main 分支后，GitHub Actions 自动打包，APK 在 Actions → 最新一次运行 → Artifacts 里下载。
- `xiaoshouji.keystore` 是 App 的签名文件：以后的新版本必须用同一个文件签名，才能直接覆盖安装、保留数据。不要删，也别公开这个仓库。

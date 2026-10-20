# 大肥鱼助手 APK 构建说明

## 一键构建

在项目目录中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
```

脚本会先运行网页测试，再生成签名后的 release APK，并复制到项目根目录。

## 后续更新

1. 修改 `dist` 中的网页代码。
2. 更新 `dist/app.js` 顶部的 `APP_VERSION`，例如从 `0.3.3` 改为 `0.3.4`。
3. 再次运行 `build-apk.ps1`。
4. 在手机上直接安装新 APK，即可覆盖旧版本并保留应用本地数据。

包名固定为 `com.dafeiyu.assistant`。版本号会根据 `APP_VERSION` 自动生成。

## 必须保留的签名文件

`android/signing/dafeiyu-release.jks` 和 `android/signing/keystore.properties` 决定 APK 的更新身份。以后所有更新必须使用同一份签名文件，否则 Android 会拒绝覆盖安装。请把这两个文件单独离线备份到安全位置。

真实签名文件和口令已被 `.gitignore` 排除，即使仓库是私有的也不要上传。仓库只保留 `android/signing/keystore.properties.example` 作为字段示例；在新电脑构建时，需要恢复原始签名文件或配置自己的新签名。

## 安装到手机

1. 把项目根目录生成的 `大肥鱼助手-v版本号.apk` 发送到安卓手机。
2. 在手机文件管理器中打开 APK；首次安装时，按系统提示允许该文件管理器安装未知来源应用。
3. 打开“大肥鱼助手”，进入设置填写 DeepSeek API Key。
4. 如需从电脑预览版迁移数据，先在电脑导出完整 JSON，再在 APK 中选择“导入备份”。

以后安装更高版本时，直接覆盖安装，不要先卸载旧版本；覆盖安装可以保留本地数据库和 API Key。

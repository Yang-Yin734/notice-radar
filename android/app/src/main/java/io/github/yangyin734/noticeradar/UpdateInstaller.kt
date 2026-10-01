package io.github.yangyin734.noticeradar

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 应用内更新：把 APK 下载到应用私有目录，再调起系统安装器。
 *
 * 目的是解决"每次都要自己去 GitHub 下载再安装"——
 * 现在流程是：应用发现新版本 → 点「应用内更新」→ 应用自己下载 → 系统弹安装确认。
 *
 * 说明（诚实）：Android 不允许应用静默安装自己的更新，**用户必须点一次系统弹出的"安装"**
 * （除非 root 或设备管理员），这一步无法绕过，也不该绕过。
 */
object UpdateInstaller {

    private const val CONNECT_TIMEOUT = 15_000
    private const val READ_TIMEOUT = 60_000

    /** 下载目录：应用私有 cache，不需要任何存储权限 */
    private fun updateDir(context: Context): File = File(context.cacheDir, "updates").apply { mkdirs() }

    /**
     * 下载 APK。onProgress 收到 0..100，总量未知时收到 -1。
     * 返回下载好的文件；失败直接抛异常（调用方展示 message）。
     */
    fun download(context: Context, url: String, version: String, onProgress: (Int) -> Unit): File {
        val target = File(updateDir(context), apkFileName(version))
        if (target.exists() && target.length() > 500_000) {
            onProgress(100) // 已经下过同一个版本，直接用
            return target
        }

        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT
            readTimeout = READ_TIMEOUT
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "notice-radar-app")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IllegalStateException("下载失败：HTTP $code")
            // 不能用 contentLengthLong（API 24+，本项目 minSdk 23）：从响应头自己解析
            val total = conn.getHeaderField("Content-Length")?.trim()?.toLongOrNull() ?: -1L
            val tmp = File(updateDir(context), "${target.name}.part")

            conn.inputStream.use { input ->
                tmp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var read = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n <= 0) break
                        output.write(buffer, 0, n)
                        read += n
                        onProgress(progressPercent(total, read))
                    }
                }
            }

            // 兜底检查：别把限流页/错误页当安装包交给系统（长度要先取，别在删除之后再读）
            val size = tmp.length()
            val header = ByteArray(2)
            tmp.inputStream().use { it.read(header) }
            if (!looksLikeApk(header, size)) {
                tmp.delete()
                throw IllegalStateException(
                    "下载到的不是安装包（${humanSize(size)}，可能是网络被拦或限流），请稍后重试或用浏览器打开",
                )
            }

            if (target.exists()) target.delete()
            if (!tmp.renameTo(target)) {
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
            onProgress(100)
            return target
        } finally {
            conn.disconnect()
        }
    }

    /** Android 8+ 需要用户允许"安装未知应用"；返回 true 表示已经允许。 */
    fun canInstall(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return context.packageManager.canRequestPackageInstalls()
    }

    /** 跳到"安装未知应用"授权页（用户点一下允许即可）。 */
    fun openInstallPermissionSettings(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return // 这个设置页 API 26 才有
        runCatching {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    /**
     * 调起系统安装器。返回 null = 已调起；否则是给用户看的说明。
     */
    fun install(context: Context, file: File): String? {
        if (!file.exists()) return "安装包不存在，请重新下载"
        if (!canInstall(context)) {
            openInstallPermissionSettings(context)
            return "请先允许本应用安装未知来源的应用（已为你打开设置），然后回来再点一次安装"
        }
        return try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            null
        } catch (e: Exception) {
            "调起安装器失败：${e.message ?: "未知错误"}（可用浏览器打开下载）"
        }
    }

    /** 已下载的更新包（用于"已下载，点这里安装"）。 */
    fun downloaded(context: Context, version: String): File? {
        val f = File(updateDir(context), apkFileName(version))
        return if (f.exists() && f.length() > 500_000) f else null
    }

    /** 清掉旧的更新包（换版本时顺手清理，别让缓存越堆越大）。 */
    fun cleanOld(context: Context, keep: String) {
        val keepName = apkFileName(keep)
        updateDir(context).listFiles()?.forEach { f ->
            if (f.name != keepName && f.name.endsWith(".apk")) f.delete()
        }
    }
}

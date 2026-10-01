package io.github.yangyin734.noticeradar

/**
 * 应用内更新的**纯逻辑**（不依赖 Android，所以能被 JVM 单元测试直接覆盖）。
 * Android 相关的下载/安装放在 UpdateInstaller.kt。
 */

/** 下载进度百分比：总量未知时返回 -1（界面据此显示"不确定进度"）。 */
fun progressPercent(total: Long, read: Long): Int {
    if (total <= 0) return -1
    val pct = ((read * 100) / total).toInt()
    return pct.coerceIn(0, 100)
}

/** 更新包文件名：带版本号，便于识别与清理；把版本号里的杂字符换掉，避免路径问题。 */
fun apkFileName(version: String): String {
    val safe = version.trim().replace(Regex("[^0-9A-Za-z._-]"), "_").ifEmpty { "unknown" }
    return "notice-radar-$safe.apk"
}

/** 人类可读的大小（给进度文案用）。 */
fun humanSize(bytes: Long): String = when {
    bytes >= 1024L * 1024 -> String.format("%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> String.format("%.0f KB", bytes / 1024.0)
    else -> "$bytes B"
}

/**
 * 下载完成后的兜底检查。
 *
 * 为什么需要：GitHub 偶发返回限流页 / 错误页（HTTP 200 但内容是 HTML），
 * 那种文件交给安装器只会报"解析包时出现问题"，用户完全看不懂。
 * APK 本质是 zip，所以看头两个字节是不是 "PK"，再要求体积别太小。
 */
fun looksLikeApk(header: ByteArray, size: Long): Boolean {
    if (size < 500_000) return false
    if (header.size < 2) return false
    return header[0] == 0x50.toByte() && header[1] == 0x4B.toByte()
}

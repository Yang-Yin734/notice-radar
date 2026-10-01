package io.github.yangyin734.noticeradar

/**
 * 纯逻辑：版本号比较。刻意放在**不依赖 Android** 的文件里 ——
 * 这样 JVM 单元测试可以直接测（放在 AppData.kt 里时，整个文件因为 import 了 android.content.Context
 * 而在单元测试编译期解析失败，连累这个函数一起"未解析"）。
 *
 * 踩过的坑：应用里原来写的是 `remote > store.appVersion()`，也就是**字符串比较** ——
 * 于是 "0.10.3" < "0.8.0"（逐字符比到 '1' vs '8'），
 * 装了 0.8.0 的手机永远显示"已是最新"，新版本根本发不出去。
 *
 * 规则：按 '.' 拆段，逐段按整数比；缺的段当 0（1.2 == 1.2.0）；
 * 非法段当 0；容忍 `v` 前缀与 `-beta` 这类后缀。
 * 返回 >0 表示 a 更新，<0 表示 a 更旧，0 表示相同。
 */
fun compareVersions(a: String?, b: String?): Int {
    val pa = (a ?: "").trim().removePrefix("v").split('.')
    val pb = (b ?: "").trim().removePrefix("v").split('.')
    val n = maxOf(pa.size, pb.size)
    for (i in 0 until n) {
        val x = pa.getOrNull(i)?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 0
        val y = pb.getOrNull(i)?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 0
        if (x != y) return if (x > y) 1 else -1
    }
    return 0
}

package io.github.yangyin734.noticeradar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 应用内更新的纯逻辑测试。
 *
 * 为什么要测：这些函数决定"进度显示对不对""下载到的到底是不是安装包"。
 * 后者尤其重要 —— GitHub 限流时会回一个 HTTP 200 的 HTML 页，
 * 如果不检查就交给安装器，用户只会看到"解析包时出现问题"，完全无从下手。
 */
class UpdateMathTest {

    @Test
    fun `进度百分比：正常、未知总量、超额都处理`() {
        assertEquals("总量未知时用 -1 表示不确定进度", -1, progressPercent(0, 100))
        assertEquals("总量为负也当作未知", -1, progressPercent(-1, 100))
        assertEquals(0, progressPercent(1000, 0))
        assertEquals(50, progressPercent(1000, 500))
        assertEquals(100, progressPercent(1000, 1000))
        assertEquals("读多了也不能超过 100", 100, progressPercent(1000, 1200))
        assertEquals(33, progressPercent(300, 100))
    }

    @Test
    fun `更新包文件名带版本号，且不含危险字符`() {
        assertEquals("notice-radar-0.10.8.apk", apkFileName("0.10.8"))
        assertEquals("notice-radar-v0.10.8.apk", apkFileName(" v0.10.8 "))
        assertEquals("斜杠要换成下划线，避免路径越界", "notice-radar-1_2_3.apk", apkFileName("1/2\\3"))
        assertEquals("notice-radar-unknown.apk", apkFileName(""))
    }

    @Test
    fun `体积文案`() {
        assertEquals("512 B", humanSize(512))
        assertEquals("1 KB", humanSize(1024))
        assertEquals("6.4 MB", humanSize(6_710_886))
    }

    @Test
    fun `像不像 APK：zip 头 PK 且体积够大才算`() {
        val pk = byteArrayOf(0x50.toByte(), 0x4B.toByte(), 0x03.toByte(), 0x04.toByte())
        assertTrue(looksLikeApk(pk, 6_000_000))
        assertFalse("太小 —— 多半是错误页，不是安装包", looksLikeApk(pk, 100_000))
        assertFalse(
            "以 <! 开头是 HTML，绝不能当安装包",
            looksLikeApk(byteArrayOf(0x3C.toByte(), 0x21.toByte()), 6_000_000),
        )
        assertFalse(looksLikeApk(ByteArray(0), 6_000_000))
    }
}

package io.github.yangyin734.noticeradar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 解析 data/last-notify.json 的回归测试。
 *
 * 为什么值得测：应用里「测试推送」给用户的结论（成功 / 失败 / 哪个通道挂了）全靠这个函数。
 * 它解析错，用户就会看到"推送成功"而手机上什么都没有 —— 比不做验证更糟。
 */
class NotifyLogTest {

    private val okLog = """
        {
          "at": "2026-10-01T10:21:59.413Z",
          "title": "电子科技大学 · 全部 43 条通知",
          "count": 43,
          "outcomes": [
            { "channel": "serverchan", "ok": true, "detail": "HTTP 200 已投递" },
            { "channel": "stdout", "ok": true, "detail": "已打印到终端" }
          ]
        }
    """.trimIndent()

    @Test
    fun `正常的成功记录能解析出来`() {
        val log = parseNotifyLog(okLog)
        assertEquals("2026-10-01T10:21:59.413Z", log?.at)
        assertEquals(43, log?.count)
        assertEquals(2, log?.outcomes?.size)
        assertTrue(log?.deliveredRemotely == true)
    }

    @Test
    fun `只有 stdout 不算真的推送到远端`() {
        val log = parseNotifyLog(
            """{ "at": "x", "count": 1, "outcomes": [ { "channel": "stdout", "ok": true, "detail": "已打印到终端" } ] }""",
        )
        assertFalse(log?.deliveredRemotely == true)
        assertTrue(log?.summary?.contains("stdout") == true)
    }

    @Test
    fun `远端通道失败时结论必须是失败（不能报喜）`() {
        val log = parseNotifyLog(
            """{ "at": "x", "count": 2, "outcomes": [
                { "channel": "serverchan", "ok": false, "detail": "缺少密钥" },
                { "channel": "stdout", "ok": true, "detail": "已打印到终端" } ] }""",
        )
        assertFalse(log?.deliveredRemotely == true)
        assertTrue(log?.summary?.contains("✗ serverchan") == true)
    }

    @Test
    fun `坏数据不崩：空串、非 JSON、缺字段、outcomes 为空或没有通道名都返回 null`() {
        assertNull(parseNotifyLog(""))
        assertNull(parseNotifyLog("不是 json"))
        assertNull(parseNotifyLog("{}"))
        assertNull(parseNotifyLog("""{ "outcomes": [] }"""))
        assertNull(parseNotifyLog("""{ "outcomes": [ {} ] }"""))
    }

    @Test
    fun `缺 at 或 count 时不影响结论（旧记录也要能读）`() {
        val log = parseNotifyLog("""{ "outcomes": [ { "channel": "serverchan", "ok": true, "detail": "ok" } ] }""")
        assertEquals("", log?.at)
        assertEquals(0, log?.count)
        assertTrue(log?.deliveredRemotely == true)
    }
}

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 版本比较的回归测试。
 *
 * 为什么要专门测它：这里踩过真坑 —— 原来用字符串比较（`remote > appVersion`），
 * 于是 "0.10.3" < "0.8.0"（逐字符比到 '1' vs '8'），装了 0.8.0 的手机永远显示"已是最新"，
 * 新版本根本发不出去。下面第一条用例就是钉住这个 bug。
 */
class VersionTest {

    @Test
    fun `两位数十位版本要比个位数大（老 bug 就死在这）`() {
        assertTrue(compareVersions("0.10.3", "0.8.0") > 0)
        assertTrue(compareVersions("0.10.0", "0.9.9") > 0)
        assertTrue(compareVersions("0.9.0", "0.10.0") < 0)
        assertTrue(compareVersions("1.0.0", "0.99.99") > 0)
        // 字符串比较会得出错误结论，这里顺手确定我们没有退回去
        assertTrue("0.10.3" < "0.8.0")
    }

    @Test
    fun `相同版本返回 0，且容忍 v 前缀与空白`() {
        assertEquals(0, compareVersions("0.10.3", "0.10.3"))
        assertEquals(0, compareVersions("v0.10.3", "0.10.3"))
        assertEquals(0, compareVersions(" 0.10.3 ", "0.10.3"))
    }

    @Test
    fun `缺段当 0（1_2 等于 1_2_0）`() {
        assertEquals(0, compareVersions("1.2", "1.2.0"))
        assertTrue(compareVersions("1.2.1", "1.2") > 0)
        assertTrue(compareVersions("1.2", "1.2.1") < 0)
    }

    @Test
    fun `补丁位逐个比较`() {
        assertTrue(compareVersions("0.10.3", "0.10.2") > 0)
        assertTrue(compareVersions("0.10.2", "0.10.3") < 0)
        assertTrue(compareVersions("2.0.0", "1.99.99") > 0)
    }

    @Test
    fun `异常输入不崩：空串、null、非数字段都当 0`() {
        assertEquals(0, compareVersions(null, null))
        assertEquals(0, compareVersions("", null))
        assertTrue(compareVersions("1.0.0", null) > 0)
        assertTrue(compareVersions(null, "1.0.0") < 0)
        assertEquals(0, compareVersions("abc", "0"))
        assertTrue(compareVersions("0.10.3-beta", "0.10.3") == 0, "带后缀时按数字段比较，不崩")
    }
}

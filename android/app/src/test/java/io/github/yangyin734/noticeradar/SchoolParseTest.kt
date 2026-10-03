package io.github.yangyin734.noticeradar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 选校功能的解析与筛选测试。
 *
 * 为什么值得测：这几行决定"用户能不能搜到自己学校""哪些学校是可选的"。
 * 一旦把 pending 当 active，用户就会选到一所永远收不到通知的学校 —— 比没有这个功能更糟。
 */
class SchoolParseTest {

    private val index = """
        {
          "counts": { "total": 3, "active": 1, "pending": 2 },
          "schools": [
            { "id": "uestc", "name": "电子科技大学", "city": "成都", "pinyin": "dianzikejidaxue",
              "abbr": "dzkjdx", "status": "active", "file": "uestc.json", "total": 43,
              "units": [ { "id": "数学科学学院", "name": "数学科学学院", "count": 21 },
                         { "id": "研究生院", "name": "研究生院", "count": 0 } ] },
            { "id": "hdu", "name": "杭州电子科技大学", "city": "杭州", "pinyin": "hangzhoudianzikejidaxue",
              "abbr": "hzdzkjdx", "status": "pending", "file": null, "total": 0, "units": [] },
            { "id": "xidian", "name": "西安电子科技大学", "city": "西安", "pinyin": "xidiandianzikejidaxue",
              "abbr": "xddzkjdx", "status": "pending", "file": null, "total": 0, "units": [] }
          ]
        }
    """.trimIndent()

    @Test
    fun `能解析目录，并区分已接入与待接入`() {
        val list = parseSchoolIndex(index)
        assertEquals(3, list.size)
        val uestc = list.first { it.id == "uestc" }
        assertTrue("uestc 应为已接入", uestc.active)
        assertEquals(43, uestc.total)
        assertEquals(2, uestc.units.size)
        assertEquals("研究生院 当前 0 条也必须能选到", 0, uestc.units[1].count)
        assertFalse("pending 不能算可用", list.first { it.id == "hdu" }.active)
    }

    @Test
    fun `搜索命中校名城市拼音简称，且已接入排最前`() {
        val list = parseSchoolIndex(index)
        val hit = searchSchools(list, "dianzi")
        assertEquals(3, hit.size)
        assertEquals("已接入的要排第一", "uestc", hit[0].id)
        assertEquals(1, searchSchools(list, "成都").size)
        assertEquals("简称也能搜", "hdu", searchSchools(list, "hzdzkjdx")[0].id)
    }

    @Test
    fun `关键词为空时只给已接入的（避免一屏 150 所）`() {
        val list = parseSchoolIndex(index)
        val hit = searchSchools(list, "   ")
        assertEquals(1, hit.size)
        assertEquals("uestc", hit[0].id)
    }

    @Test
    fun `limit 生效，坏数据不崩`() {
        val list = parseSchoolIndex(index)
        assertEquals(1, searchSchools(list, "dianzi", limit = 1).size)
        assertTrue(parseSchoolIndex("").isEmpty())
        assertTrue(parseSchoolIndex("不是 json").isEmpty())
        assertTrue(parseSchoolIndex("{}").isEmpty())
        assertTrue("缺少 id 的条目要跳过", parseSchoolIndex("""{"schools":[{"name":"x"}]}""").isEmpty())
    }

    @Test
    fun `解析某校数据文件，拿到条数与学院列表`() {
        val payload = """{ "school":"uestc", "total":2, "items":[{},{}],
            "units":[{"name":"教务处","count":2},{"name":"研究生院","count":0}] }"""
        val parsed = parseSchoolPayload(payload)
        assertEquals(2, parsed?.first)
        assertEquals(listOf("教务处", "研究生院"), parsed?.second)
        assertNull(parseSchoolPayload("{}"))
        assertNull(parseSchoolPayload("坏数据"))
    }
}

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
 *
 * 2026-10 起目录扩到全国 3167 所，所以这里额外钉住三件事：
 *   · 省份/层次/学校标识码要能解析（id 与标识码不再总是同一个值）
 *   · 关键词为空时给的是「已接入 + 重点」，不是把 3167 所全倒出来
 *   · 层次排序（本科在专科/成人前）与「申请接入」链接的预填
 */
class SchoolParseTest {

    private val index = """
        {
          "counts": { "total": 6, "active": 1, "pending": 5 },
          "schools": [
            { "id": "uestc", "name": "电子科技大学", "province": "四川省", "city": "成都市",
              "level": "本科", "code": "4151010614", "pinyin": "dianzikejidaxue", "abbr": "dzkjdx",
              "featured": true, "status": "active", "file": "uestc.json", "total": 43,
              "units": [ { "id": "数学科学学院", "name": "数学科学学院", "count": 21 },
                         { "id": "研究生院", "name": "研究生院", "count": 0 } ] },
            { "id": "hdu", "name": "杭州电子科技大学", "province": "浙江省", "city": "杭州市",
              "level": "本科", "pinyin": "hangzhoudianzikejidaxue", "abbr": "hzdzkjdx",
              "featured": true, "status": "pending" },
            { "id": "xidian", "name": "西安电子科技大学", "province": "陕西省", "city": "西安市",
              "level": "本科", "status": "pending" },
            { "id": "4161012345", "name": "西安航空职业技术学院", "province": "陕西省", "city": "西安市",
              "level": "专科", "status": "pending" },
            { "id": "4133010337", "name": "浙江警官职业学院", "province": "浙江省", "city": "杭州市",
              "level": "专科", "status": "pending" },
            { "id": "4234050569", "name": "合肥职工科技大学", "province": "安徽省",
              "level": "成人", "status": "pending" }
          ]
        }
    """.trimIndent()

    @Test
    fun `能解析目录，并区分已接入与待接入`() {
        val list = parseSchoolIndex(index)
        assertEquals(6, list.size)
        val uestc = list.first { it.id == "uestc" }
        assertTrue("uestc 应为已接入", uestc.active)
        assertEquals(43, uestc.total)
        assertEquals(2, uestc.units.size)
        assertEquals("研究生院 当前 0 条也必须能选到", 0, uestc.units[1].count)
        assertFalse("pending 不能算可用", list.first { it.id == "hdu" }.active)
    }

    @Test
    fun `解析省份层次与学校标识码（没有 code 时 id 就是标识码）`() {
        val list = parseSchoolIndex(index)
        val uestc = list.first { it.id == "uestc" }
        assertEquals("四川省 · 成都市", uestc.where)
        assertEquals("本科", uestc.level)
        assertEquals("短 id 的学校要单独带 code", "4151010614", uestc.code)

        val hdu = list.first { it.id == "hdu" }
        assertEquals("目录里没写 code 时，id 就是学校标识码", "hdu", hdu.code)
        assertEquals("浙江省 · 杭州市", hdu.where)

        val adult = list.first { it.id == "4234050569" }
        assertEquals("成人", adult.level)
        assertEquals("没有城市时位置只显示省份", "安徽省", adult.where)
    }

    @Test
    fun `搜索命中校名省份城市拼音简称与标识码`() {
        val list = parseSchoolIndex(index)
        assertEquals("按校名", 3, searchSchools(list, "电子科技").size)
        assertEquals("已接入的排最前", "uestc", searchSchools(list, "电子科技")[0].id)
        assertEquals("按拼音", 2, searchSchools(list, "dianzi").size)
        assertEquals("按省份", 2, searchSchools(list, "浙江").size)
        assertEquals("按城市", 2, searchSchools(list, "西安").size)
        assertEquals("按简称", "hdu", searchSchools(list, "hzdzkjdx")[0].id)
        assertEquals("按学校标识码", "4234050569", searchSchools(list, "4234050569")[0].id)
        assertEquals("一个都不匹配时返回空表", 0, searchSchools(list, "不存在的学校").size)
    }

    @Test
    fun `关键词为空时给已接入与重点高校，且本科排在专科成人前面`() {
        val list = parseSchoolIndex(index)
        val hit = searchSchools(list, "   ")
        assertEquals("3167 所全倒出来没法用：只给已接入 + 重点", 2, hit.size)
        assertEquals("uestc", hit[0].id)

        // 两所都不是重点、也不是已接入，只按层次分先后
        val xian = searchSchools(list, "西安")
        assertEquals("本科要在专科前面", "xidian", xian[0].id)
        assertEquals("4161012345", xian[1].id)
    }

    @Test
    fun `申请接入的链接带校名预填`() {
        val url = requestIssueUrl("电子科技大学")
        assertTrue(url.startsWith("https://github.com/Yang-Yin734/notice-radar/issues/new?template=adapter-request.yml"))
        assertTrue("校名要预填到 school 字段", url.contains("school=%E7%94%B5%E5%AD%90%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6"))
        assertTrue("标题也要预填", url.contains("title=%5Badapter%5D+"))
    }

    @Test
    fun `limit 生效，坏数据不崩`() {
        val list = parseSchoolIndex(index)
        assertEquals(1, searchSchools(list, "电子科技", limit = 1).size)
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

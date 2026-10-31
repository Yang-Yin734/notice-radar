package io.github.yangyin734.noticeradar

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * org.json 的 optString 在字段为 JSON null 时返回字符串 "null"（不是空串），
 * 所以 ifEmpty { null } 拦不住它 —— 列表上会真的多出一个写着 null 的标签，
 * 学校目录里 file="null" 甚至会让 isNullOrEmpty 判定通过、以为这所学校能抓。
 * 凡是从 JSON 取可空字符串都走这里。
 */
private fun JSONObject.optText(key: String): String? =
    optString(key).takeIf { it.isNotEmpty() && it != "null" }

/** 一条通知。字段与网页版 dashboard-data.json 对齐（unit 只在按校数据里出现）。 */
data class Notice(
    val id: String,
    val title: String,
    val url: String,
    val date: String,
    val tag: String?,
    val sourceId: String,
    val sourceName: String,
    val firstSeenAt: String,
    val unit: String? = null,
    /** 截止日（YYYY-MM-DD），出现在正文里的办事型通知才有；老数据没有这个字段。 */
    val deadline: String? = null,
)

data class SourceStat(val sourceId: String, val sourceName: String, val count: Int)

/** 一份数据快照（内置或从镜像拉到的）。 */
data class Snapshot(
    val generatedAt: String,
    val total: Int,
    val items: List<Notice>,
    val bySource: List<SourceStat>,
)

/**
 * 数据源候选，**按新鲜度排**，可达性垫底。
 *
 * 顺序为什么这么定（2026-10-31 实测）：
 *   · raw.githack —— `cache-control: max-age=60`，一分钟就换新，是唯一接近实时的镜像
 *   · statically  —— 走 Cloudflare，时效性尚可
 *   · github.io   —— `max-age=600`，但国内经常连不上
 *   · jsDelivr    —— 最快最稳，但 `@main` 分支别名的响应头是
 *                    `max-age=604800, s-maxage=43200`（7 天 / 12 小时）：
 *                    实测 0.15.0 发布 3 小时后它还在返 0.13.0，而旧版顺序把它放第一位，
 *                    于是「检查更新」拿到比当前还旧的号 → 判"已是最新" → 新版永远推不出去；
 *                    通知数据也跟着晚了半天。所以它降为兜底。
 *
 * 真正的兜底逻辑在 [refresh]：按顺序试，第一个能解析的就用 —— 前面都挂了才轮到 jsDelivr 的旧数据，
 * 旧数据总好过没有。
 */
val DATA_URLS = listOf(
    "https://raw.githack.com/Yang-Yin734/notice-radar/main/docs/dashboard-data.json",
    "https://cdn.statically.io/gh/Yang-Yin734/notice-radar/main/docs/dashboard-data.json",
    "https://yang-yin734.github.io/notice-radar/dashboard-data.json",
    "https://cdn.jsdelivr.net/gh/Yang-Yin734/notice-radar@main/docs/dashboard-data.json",
)

val VERSION_URLS = DATA_URLS.map { it.substringBefore("dashboard-data.json") + "version.json" }

/**
 * 给镜像 URL 加一个按分钟取整的穿透参数。
 *
 * 为什么必须有：jsDelivr 对 `@main` 分支别名的响应头是
 * `cache-control: public, max-age=604800, s-maxage=43200`（7 天 / 12 小时），
 * 实测 0.15.0 发布 3 小时后，它仍在返回 0.13.0。而 DATA_URLS 的第一项就是它，
 * 于是「检查更新」拿到一个**比当前还旧**的版本号，compareVersions 判为"不更新"，
 * 新版永远推不出去；`dashboard-data.json` 同样被缓存到 12 小时前的样子。
 *
 * 参数按 [slotMinutes] 取整而不是用毫秒：同一时段内多个请求仍命中同一份 CDN 缓存
 * （手机在弱网下会重试，不想每次都打穿），跨过时段才换新。
 */
internal fun bust(url: String, slotMinutes: Int = 5): String {
    val slot = System.currentTimeMillis() / (slotMinutes * 60_000L)
    val sep = if (url.contains('?')) '&' else '?'
    return "$url${sep}v=$slot"
}

const val REPO_SLUG = "Yang-Yin734/notice-radar"

// ---------------------------------------------------------------- 学校目录（选校功能）

/** 一所学校下的学院/栏目（对应 index.json 里 units[]；count 是当前条数，可能是 0） */
data class SchoolUnit(val name: String, val count: Int)

/** 学校目录条目（对应 docs/data/schools/index.json 的 schools[]） */
data class SchoolInfo(
    val id: String,
    val name: String,
    val province: String,
    val city: String,
    val level: String,
    val code: String,
    val pinyin: String,
    val abbr: String,
    val featured: Boolean,
    val tags: List<String>,
    val status: String,
    val file: String?,
    val units: List<SchoolUnit>,
    val total: Int,
) {
    /** 只有 active 才真的能抓到通知；pending 只是目录条目，不能假装能用 */
    val active: Boolean get() = status == "active" && !file.isNullOrEmpty()

    /** 展示用位置：「四川省 · 成都市」（直辖市与成人高校可能没有城市） */
    val where: String get() = listOf(province, city).filter { it.isNotEmpty() }.joinToString(" · ")

    /** 最值得在列表里露出来的那个标签：双一流是官方标签，其次民办 */
    val tag: String? get() = when {
        tags.contains("双一流") -> "双一流"
        tags.contains("民办") -> "民办"
        else -> null
    }
}

/**
 * 解析学校目录。做成纯函数（只吃字符串）以便 JVM 单测 ——
 * 解析错了会让用户以为"能选"，实则永远收不到通知。
 */
fun parseSchoolIndex(json: String): List<SchoolInfo> {
    return try {
        val arr = JSONObject(json).optJSONArray("schools") ?: JSONArray()
        (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val id = o.optString("id")
            if (id.isEmpty()) return@mapNotNull null
            val unitsArr = o.optJSONArray("units") ?: JSONArray()
            val units = (0 until unitsArr.length()).mapNotNull { j ->
                val u = unitsArr.optJSONObject(j) ?: return@mapNotNull null
                val name = u.optString("name")
                if (name.isEmpty()) null else SchoolUnit(name = name, count = u.optInt("count", 0))
            }
            val tagsArr = o.optJSONArray("tags") ?: JSONArray()
            val tags = (0 until tagsArr.length()).mapNotNull { j -> tagsArr.optString(j).takeIf { it.isNotEmpty() && it != "null" } }
            SchoolInfo(
                id = id,
                name = o.optString("name"),
                province = o.optString("province"),
                city = o.optString("city"),
                level = o.optString("level"),
                // 短 id 的学校会在目录里单列 code；其余学校的 id 就是学校标识码
                code = o.optString("code").ifEmpty { id },
                pinyin = o.optString("pinyin"),
                abbr = o.optString("abbr"),
                featured = o.optBoolean("featured"),
                tags = tags,
                status = o.optString("status"),
                file = o.optText("file"),
                units = units,
                total = o.optInt("total", 0),
            )
        }
    } catch (e: Exception) {
        emptyList()
    }
}

/**
 * 按关键词筛选学校：命中校名 / 省份 / 城市 / 拼音 / 简称 / 学校标识码；
 * 已接入 → 重点高校 → 本科 → 专科 → 成人，再按校名。
 *
 * 关键词为空时给的是「已接入 + 重点高校」，**不是全部**：全国名单有 3167 所，
 * 一次列出来既慢又没法用（用户是来搜的，不是来翻目录的）。
 */
fun searchSchools(list: List<SchoolInfo>, query: String, limit: Int = 40): List<SchoolInfo> {
    val q = query.trim().lowercase()
    val hit = list.filter { s ->
        if (q.isEmpty()) return@filter s.active || s.featured
        listOf(s.name, s.province, s.city, s.pinyin, s.abbr, s.code).any { it.lowercase().contains(q) }
    }
    return hit
        .sortedWith(
            compareBy(
                { if (it.active) 0 else 1 },
                { if (it.featured) 0 else 1 },
                { when (it.level) { "本科" -> 0; "专科" -> 1; else -> 2 } },
                { it.name },
            ),
        )
        .take(limit)
}

/**
 * 「申请接入这所学校」的直达 issue 链接（校名预填）。
 * 全国名单里绝大多数学校还没接入，与其让用户干看着，不如让需求一键变成 issue。
 */
fun requestIssueUrl(schoolName: String): String {
    val title = java.net.URLEncoder.encode("[adapter] $schoolName", "UTF-8")
    val school = java.net.URLEncoder.encode(schoolName, "UTF-8")
    return "https://github.com/$REPO_SLUG/issues/new?template=adapter-request.yml&title=$title&school=$school"
}

/** 解析某校的数据文件，返回 (条目数, 学院名列表) —— 切换后用来确认真拿到了数据 */
fun parseSchoolPayload(json: String): Pair<Int, List<String>>? {
    return try {
        val root = JSONObject(json)
        val items = root.optJSONArray("items") ?: return null
        val unitsArr = root.optJSONArray("units") ?: JSONArray()
        val units = (0 until unitsArr.length()).mapNotNull { i ->
            unitsArr.optJSONObject(i)?.optString("name")?.takeIf { it.isNotEmpty() && it != "null" }
        }
        items.length() to units
    } catch (e: Exception) {
        null
    }
}

/**
 * 条目属于哪个学院/栏目：数据里带 unit 就用它，否则按源名「教务处·重要公告」取前缀。
 * 与网页版 unitOf() 同一套规则 —— 两边过滤结果必须一致，否则用户会以为应用"漏通知"。
 */
fun unitOf(n: Notice): String {
    val explicit = n.unit
    if (!explicit.isNullOrEmpty()) return explicit
    return n.sourceName.substringBefore("·").ifEmpty { "其它" }
}

/**
 * 列表过滤（与网页版 visible() 同一套规则）。
 *
 * 刻意做成**纯函数**（只吃数据、不碰界面与网络），这样"选了学校却什么都看不到"这类
 * 最容易被用户当成 bug 的行为，能被 JVM 单测直接钉住：
 *   - 没主动选过学校（schoolId 为空）→ 照旧全部显示，老用户不受影响；
 *   - 选过学校但一个学院都没勾 → **什么都不显示**（界面会提示"请先勾选学院"），
 *     这是产品要求，不能擅自"贴心地"显示全部；
 *   - 勾了学院 → 只看勾选的那些学院/栏目。
 */
fun filterNotices(
    items: List<Notice>,
    query: String,
    sourceFilter: String?,
    favOnly: Boolean,
    fav: Set<String>,
    schoolId: String,
    units: Set<String>,
): List<Notice> {
    val q = query.trim().lowercase()
    return items.filter { n ->
        (!favOnly || n.id in fav) &&
            (sourceFilter == null || n.sourceId == sourceFilter) &&
            (schoolId.isEmpty() || (units.isNotEmpty() && unitOf(n) in units)) &&
            (q.isEmpty() || (n.title + " " + (n.tag ?: "") + " " + n.sourceName).lowercase().contains(q))
    }
}

fun labelOf(url: String): String = when {
    url.contains("jsdelivr") -> "jsDelivr 镜像"
    url.contains("statically") -> "Statically 镜像"
    url.contains("githack") -> "githack 镜像"
    url.contains("github.io") -> "GitHub Pages"
    else -> url
}

object Json {
    fun parseSnapshot(raw: String): Snapshot? {
        return try {
            val root = JSONObject(raw)
            val arr = root.optJSONArray("items") ?: JSONArray()
            val items = (0 until arr.length()).mapNotNull { i ->
                val n = arr.optJSONObject(i) ?: return@mapNotNull null
                Notice(
                    id = n.optString("id"),
                    title = n.optString("title"),
                    url = n.optString("url"),
                    date = n.optString("date"),
                    tag = n.optText("tag"),
                    sourceId = n.optString("sourceId"),
                    sourceName = n.optString("sourceName"),
                    firstSeenAt = n.optString("firstSeenAt"),
                    unit = n.optText("unit"),
                    deadline = n.optText("deadline"),
                )
            }
            if (items.isEmpty()) {
                null
            } else {
                val srcArr = root.optJSONArray("bySource") ?: JSONArray()
                val bySource = (0 until srcArr.length()).mapNotNull { i ->
                    val s = srcArr.optJSONObject(i) ?: return@mapNotNull null
                    SourceStat(s.optString("sourceId"), s.optString("sourceName"), s.optInt("count"))
                }
                Snapshot(root.optString("generatedAt"), root.optInt("total", items.size), items, bySource)
            }
        } catch (e: Exception) {
            null
        }
    }
}

/** 网络抓取（只用 HttpURLConnection，不引第三方库）。 */
object Net {
    fun get(url: String, timeoutMs: Int = 12000): String? = try {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            setRequestProperty("Accept", "application/json")
            // 全国学校目录有 500 KB 上下：镜像站都支持 gzip，不声明的话手机要下全量。
            // 只在自己声明了、且响应确实带 Content-Encoding: gzip 时才解压，避免解错。
            setRequestProperty("Accept-Encoding", "gzip")
            setRequestProperty("User-Agent", "notice-radar-app")
            // 配合 bust() 使用：让中间层知道我们要现成的。有的 CDN 认这个头，有的只认 query。
            setRequestProperty("Cache-Control", "no-cache")
            // Android 的 HttpURLConnection 默认会走 OkHttp 的 HTTP 缓存时，用 no-cache 会被它拦住；
            // 这里显式声明按响应头走，不做本地强缓存。
            useCaches = false
        }
        val raw = conn.inputStream
        val gzipped = conn.contentEncoding?.contains("gzip", ignoreCase = true) == true
        val stream = if (gzipped) java.util.zip.GZIPInputStream(raw) else raw
        val text = stream.bufferedReader().use(BufferedReader::readText)
        conn.disconnect()
        text
    } catch (e: Exception) {
        null
    }
}

/**
 * 应用状态：内置数据 / 本机缓存 / 已读收藏 / 令牌 / 主题 / 推送开关。
 * 全部存 SharedPreferences，不联网也能用。
 */
class Store(private val ctx: Context) {

    private val prefs = ctx.getSharedPreferences("notice-radar", Context.MODE_PRIVATE)
    private val assets = ctx.assets

    // ---------- 数据 ----------
    fun bundled(): Snapshot? = try {
        assets.open("data/dashboard-data.json").bufferedReader().use(BufferedReader::readText).let(Json::parseSnapshot)
    } catch (e: Exception) {
        null
    }

    fun cached(): Snapshot? = prefs.getString("dataJson", null)?.let(Json::parseSnapshot)

    fun cache(raw: String, source: String) {
        prefs.edit().putString("dataJson", raw).putString("dataSource", source)
            .putLong("dataAt", System.currentTimeMillis()).apply()
    }

    var dataSource: String
        get() = prefs.getString("dataSource", "内置数据") ?: "内置数据"
        set(value) = prefs.edit().putString("dataSource", value).apply()

    fun dataAt(): Long = prefs.getLong("dataAt", 0L)

    /**
     * 按镜像顺序拉数据，返回（快照, 来源标签）或 null（全失败）。
     *
     * 「第一个能解析的就用」这条规则还不够 —— githack 虽然响应头写 `max-age=60`，
     * 实测它的边缘缓存比声明的时间长（推了 0.15.1 之后 5 分钟仍返 0.15.0 的数据）。
     * 所以这里加一道新鲜度判断：拿到的 `generatedAt` 若比本机已有的还旧，就继续试下一个镜像，
     * 都试完仍不如本机就退回本机已有的那份 —— 宁可用缓存，也不要用更旧的数据覆盖。
     */
    fun refresh(): Pair<Snapshot, String>? {
        val knownAt = cached()?.generatedAt ?: bundled()?.generatedAt
        var best: Triple<String, Snapshot, String>? = null
        for (url in DATA_URLS) {
            val raw = Net.get(bust(url)) ?: continue
            val snap = Json.parseSnapshot(raw) ?: continue
            val label = labelOf(url)
            if (best == null || snap.generatedAt > best.second.generatedAt) best = Triple(raw, snap, label)
            // 不比本机旧：这就是要的（绝大多数情况第一次就命中，不会真去试四个镜像）
            if (knownAt == null || snap.generatedAt >= knownAt) {
                cache(raw, label)
                return snap to label
            }
        }
        best?.let { (raw, snap, label) ->
            cache(raw, label)
            return snap to label
        }
        return null
    }

    // ------------------------------------------------ 选校：偏好 + 数据拉取

    /** 已选学校 id（空 = 没主动选过 → 继续显示默认数据，老用户不受影响） */
    var schoolId: String
        get() = prefs.getString("schoolId", "") ?: ""
        set(value) = prefs.edit().putString("schoolId", value).apply()

    /**
     * 已选学校的数据文件名（如 uestc.json）。
     * 单独记一份是**为了离线也能恢复**：冷启动时不必先联网取目录就知道该读哪个文件。
     */
    var schoolFile: String
        get() = prefs.getString("schoolFile", "") ?: ""
        set(value) = prefs.edit().putString("schoolFile", value).apply()

    /** 已勾选的学院/栏目（空集合 = 全不选，这是产品要求的默认值） */
    fun schoolUnits(): Set<String> = HashSet(prefs.getStringSet("schoolUnits", emptySet()) ?: emptySet())

    fun saveSchoolUnits(units: Set<String>) =
        prefs.edit().putStringSet("schoolUnits", HashSet(units)).apply()

    /** 学校目录：先按 DATA_URLS 的镜像顺序试，全失败就退回**内置目录**（离线也要能选校） */
    fun fetchSchoolIndex(): List<SchoolInfo> {
        for (url in schoolUrls("index.json")) {
            val raw = Net.get(bust(url)) ?: continue
            val list = parseSchoolIndex(raw)
            if (list.isNotEmpty()) return list
        }
        return bundledSchoolIndex()
    }

    /** 打包在 APK 里的学校目录（没有就返回空表，界面据此提示"取不到"） */
    fun bundledSchoolIndex(): List<SchoolInfo> = try {
        assets.open("data/schools/index.json").bufferedReader().use(BufferedReader::readText)
            .let(::parseSchoolIndex)
    } catch (e: Exception) {
        emptyList()
    }

    /** 打包在 APK 里的某校数据（离线切换学校用） */
    fun bundledSchool(file: String): Snapshot? = try {
        assets.open("data/schools/$file").bufferedReader().use(BufferedReader::readText)
            .let(Json::parseSnapshot)
    } catch (e: Exception) {
        null
    }

    /** 上次成功拉到的某校数据（只在文件对得上时才用，避免串校） */
    fun cachedSchool(file: String): Snapshot? =
        if (file.isNotEmpty() && prefs.getString("schoolFile", "") == file) {
            prefs.getString("schoolDataJson", null)?.let(Json::parseSnapshot)
        } else {
            null
        }

    private fun cacheSchool(file: String, raw: String, source: String) {
        prefs.edit()
            .putString("schoolFile", file)
            .putString("schoolDataJson", raw)
            .putString("schoolSource", source)
            .putLong("schoolAt", System.currentTimeMillis())
            .apply()
    }

    fun schoolSource(): String = prefs.getString("schoolSource", "") ?: ""

    fun schoolAt(): Long = prefs.getLong("schoolAt", 0L)

    /**
     * 拉某校的数据文件：网络（按镜像顺序）→ 本机缓存 → APK 内置。
     * 三级兜底是刻意的：用户选了学校之后，**哪怕离线也不该突然变回默认学校的数据**。
     */
    fun refreshSchool(file: String): Pair<Snapshot, String>? {
        if (file.isEmpty()) return null
        for (url in schoolUrls(file)) {
            val raw = Net.get(bust(url)) ?: continue
            val snap = Json.parseSnapshot(raw) ?: continue
            val label = labelOf(url)
            cacheSchool(file, raw, label)
            return snap to label
        }
        cachedSchool(file)?.let { return it to "本机缓存" }
        bundledSchool(file)?.let { return it to "内置数据" }
        return null
    }

    /** 把 dashboard-data.json 的地址换成 data/schools/<file>（与网页端同一套推导，四个镜像都能用） */
    private fun schoolUrls(file: String): List<String> =
        DATA_URLS.map { it.substringBefore("dashboard-data.json") + "data/schools/" + file }

    /**
     * 所有镜像里**最新**的版本号（全都取不到才返回 null）。
     *
     * 原先是「按顺序取第一个成功的」—— 于是 jsDelivr 的 12 小时缓存直接决定了
     * 整个更新体系：它返 0.13.0，用户装 0.14.0，compareVersions 判"已是最新"，
     * 0.15.0 发出去也没人收到提示。改成取最大值后，任何一个镜像拿到新版就算数。
     */
    fun remoteVersion(): String? {
        var best: String? = null
        for (url in VERSION_URLS) {
            val raw = Net.get(bust(url)) ?: continue
            val v = try {
                JSONObject(raw).optString("version")
            } catch (e: Exception) {
                ""
            }
            if (v.isEmpty()) continue
            if (best == null || compareVersions(v, best) > 0) best = v
        }
        return best
    }

    fun appVersion(): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }

    /** 用户关掉过的"新版本提示"对应的版本号（每个新版本只提示一次） */
    var dismissedUpdateVersion: String
        get() = prefs.getString("dismissedUpdateVersion", "") ?: ""
        set(value) = prefs.edit().putString("dismissedUpdateVersion", value).apply()

    fun apkUrl(): String = "https://github.com/$REPO_SLUG/releases/download/android-latest/notice-radar.apk"

    // ---------- 已读 / 收藏 ----------
    fun readIds(): MutableSet<String> = HashSet(prefs.getStringSet("read", emptySet()) ?: emptySet())
    fun favIds(): MutableSet<String> = HashSet(prefs.getStringSet("fav", emptySet()) ?: emptySet())
    fun saveRead(ids: Set<String>) = prefs.edit().putStringSet("read", HashSet(ids)).apply()
    fun saveFav(ids: Set<String>) = prefs.edit().putStringSet("fav", HashSet(ids)).apply()

    // ---------- 后台提醒 ----------
    /** 后台提醒开关。默认关：装上就先安安静静，要不要闹钟由用户在设置里决定。 */
    var notifyEnabled: Boolean
        get() = prefs.getBoolean("notifyEnabled", false)
        set(value) = prefs.edit().putBoolean("notifyEnabled", value).apply()

    /** 已经弹过系统通知的条目 id。与"已读"分开记：看过不等于被提醒过，反之亦然。 */
    fun notifiedIds(): MutableSet<String> = HashSet(prefs.getStringSet("notified", emptySet()) ?: emptySet())
    fun saveNotified(ids: Set<String>) = prefs.edit().putStringSet("notified", HashSet(ids)).apply()

    // ---------- 主题 ----------
    /** null = 跟随系统 */
    var themeOverride: Boolean?
        get() = if (!prefs.contains("darkOverride")) null else prefs.getBoolean("darkOverride", false)
        set(value) {
            if (value == null) prefs.edit().remove("darkOverride").apply()
            else prefs.edit().putBoolean("darkOverride", value).apply()
        }

}

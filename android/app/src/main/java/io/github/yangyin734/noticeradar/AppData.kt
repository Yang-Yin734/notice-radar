package io.github.yangyin734.noticeradar

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/** 一条通知。字段与网页版 dashboard-data.json 对齐。 */
data class Notice(
    val id: String,
    val title: String,
    val url: String,
    val date: String,
    val tag: String?,
    val sourceId: String,
    val sourceName: String,
    val firstSeenAt: String,
)

data class SourceStat(val sourceId: String, val sourceName: String, val count: Int)

/** 一份数据快照（内置或从镜像拉到的）。 */
data class Snapshot(
    val generatedAt: String,
    val total: Int,
    val items: List<Notice>,
    val bySource: List<SourceStat>,
)

/** 数据源候选：github.io 在国内经常不通，所以镜像排在前面，最后用它垫底。 */
val DATA_URLS = listOf(
    "https://cdn.jsdelivr.net/gh/Yang-Yin734/notice-radar@main/docs/dashboard-data.json",
    "https://cdn.statically.io/gh/Yang-Yin734/notice-radar/main/docs/dashboard-data.json",
    "https://raw.githack.com/Yang-Yin734/notice-radar/main/docs/dashboard-data.json",
    "https://yang-yin734.github.io/notice-radar/dashboard-data.json",
)

val VERSION_URLS = DATA_URLS.map { it.substringBefore("dashboard-data.json") + "version.json" }

const val REPO_SLUG = "Yang-Yin734/notice-radar"

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
                    tag = n.optString("tag").ifEmpty { null },
                    sourceId = n.optString("sourceId"),
                    sourceName = n.optString("sourceName"),
                    firstSeenAt = n.optString("firstSeenAt"),
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
            setRequestProperty("User-Agent", "notice-radar-app")
        }
        val text = conn.inputStream.bufferedReader().use(BufferedReader::readText)
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

    /** 按镜像顺序拉数据，返回（快照, 来源标签）或 null（全失败）。 */
    fun refresh(): Pair<Snapshot, String>? {
        for (url in DATA_URLS) {
            val raw = Net.get(url) ?: continue
            val snap = Json.parseSnapshot(raw) ?: continue
            val label = labelOf(url)
            cache(raw, label)
            return snap to label
        }
        return null
    }

    fun remoteVersion(): String? {
        for (url in VERSION_URLS) {
            val raw = Net.get(url) ?: continue
            val v = try {
                JSONObject(raw).optString("version")
            } catch (e: Exception) {
                ""
            }
            if (v.isNotEmpty()) return v
        }
        return null
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

    // ---------- 主题 ----------
    /** null = 跟随系统 */
    var themeOverride: Boolean?
        get() = if (!prefs.contains("darkOverride")) null else prefs.getBoolean("darkOverride", false)
        set(value) {
            if (value == null) prefs.edit().remove("darkOverride").apply()
            else prefs.edit().putBoolean("darkOverride", value).apply()
        }

    // ---------- 微信推送开关（读写仓库变量） ----------
    var githubToken: String
        get() = prefs.getString("ghToken", "") ?: ""
        set(value) = prefs.edit().putString("ghToken", value).apply()

    private fun ghRequest(method: String, path: String, body: String?): Pair<Int, String> {
        return try {
            val conn = (URL("https://api.github.com/repos/$REPO_SLUG$path").openConnection() as HttpURLConnection)
            conn.requestMethod = method
            conn.connectTimeout = 12000
            conn.readTimeout = 12000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("Authorization", "Bearer ${githubToken}")
            conn.setRequestProperty("User-Agent", "notice-radar-app")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            conn.disconnect()
            code to text
        } catch (e: Exception) {
            -1 to (e.message ?: "网络错误")
        }
    }

    /** null = 未知（没令牌或连不上）；true/false = 当前是否开启 */
    fun fetchPushEnabled(): Boolean? {
        if (githubToken.isEmpty()) return null
        val (code, text) = ghRequest("GET", "/actions/variables/PUSH_ENABLED", null)
        if (code == 404) return true // 变量没设置 = 默认开启
        if (code != 200) return null
        return try {
            JSONObject(text).optString("value") != "false"
        } catch (e: Exception) {
            null
        }
    }

    /** null = 成功；否则是给用户看的错误说明 */
    fun setPushEnabled(enabled: Boolean): String? {
        val body = JSONObject().put("name", "PUSH_ENABLED").put("value", if (enabled) "true" else "false").toString()
        var (code, text) = ghRequest("PATCH", "/actions/variables/PUSH_ENABLED", body)
        if (code == 404) {
            val post = ghRequest("POST", "/actions/variables", body)
            code = post.first
            text = post.second
        }
        if (code in 200..299) return null
        return "HTTP $code" + if (text.isNotBlank()) "：" + text.take(140) else ""
    }
}

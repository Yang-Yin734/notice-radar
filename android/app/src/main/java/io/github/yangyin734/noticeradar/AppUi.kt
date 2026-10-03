package io.github.yangyin734.noticeradar

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// ---------------------------------------------------------------- 主题

private val LightColors = lightColorScheme(
    primary = Color(0xFF1C7ED6),
    onPrimary = Color.White,
    background = Color(0xFFF1F5FA),
    onBackground = Color(0xFF1F2A3D),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1F2A3D),
    surfaceVariant = Color(0xFFE9ECF1),
    onSurfaceVariant = Color(0xFF6B7280),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF4DABF7),
    onPrimary = Color(0xFF0B2033),
    background = Color(0xFF12161F),
    onBackground = Color(0xFFE9ECEF),
    surface = Color(0xFF1B212C),
    onSurface = Color(0xFFE9ECEF),
    surfaceVariant = Color(0xFF2A313D),
    onSurfaceVariant = Color(0xFF9AA4B2),
)

private fun tagColor(tag: String?): Color = when {
    tag == null -> Color(0xFF6B7280)
    tag.contains("考试") || tag.contains("补考") || tag.contains("缓考") -> Color(0xFFE8590C)
    tag.contains("教管") || tag.contains("教学") -> Color(0xFF1C7ED6)
    tag.contains("学生事务") -> Color(0xFF2F9E44)
    tag.contains("实践") -> Color(0xFF7048E8)
    tag.contains("学术") || tag.contains("讲座") -> Color(0xFF0B7285)
    else -> Color(0xFF6B7280)
}

// ---------------------------------------------------------------- 根界面

@Composable
fun NoticeRadarApp(store: Store) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var tab by remember { mutableStateOf(0) }
    var snapshot by remember { mutableStateOf<Snapshot?>(null) }
    var query by remember { mutableStateOf("") }
    var sourceFilter by remember { mutableStateOf<String?>(null) }
    var read by remember { mutableStateOf(store.readIds()) }
    var fav by remember { mutableStateOf(store.favIds()) }
    var refreshing by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    // 新版本提示：打开应用就检查一次（以前只在"设置 → 应用更新"里查，用户根本看不到）
    var updateVersion by remember { mutableStateOf<String?>(null) }
    // 选校：学校 id / 已勾选学院 / 学校目录。全部只在本机记忆（schoolId 为空 = 没主动选过）
    var schoolId by remember { mutableStateOf(store.schoolId) }
    var units by remember { mutableStateOf(store.schoolUnits()) }
    var schoolIndex by remember { mutableStateOf<List<SchoolInfo>?>(null) }
    var indexLoading by remember { mutableStateOf(false) }
    val schoolName = schoolIndex?.firstOrNull { it.id == schoolId }?.name ?: schoolId

    // 打开：先用内置/缓存（零网络），再静默尝试镜像。
    // 选过学校的用户，直接恢复**那所学校**的数据 —— 不能因为重启就悄悄变回默认学校。
    LaunchedEffect(Unit) {
        val bundled = store.bundled()
        val cached = store.cached()
        snapshot = when {
            cached != null && bundled != null && cached.generatedAt > bundled.generatedAt -> cached
            cached != null && bundled == null -> cached
            else -> bundled
        }
        // 离线也先给"上次那所学校"的缓存/内置数据，避免闪回默认学校
        if (store.schoolId.isNotEmpty() && store.schoolFile.isNotEmpty()) {
            (store.cachedSchool(store.schoolFile) ?: store.bundledSchool(store.schoolFile))?.let { snapshot = it }
        }
        withContext(Dispatchers.IO) {
            val selected = store.schoolId
            if (selected.isNotEmpty()) {
                // schoolFile 缺失（老数据/异常）时用目录补上，否则读不到该校数据
                val file = store.schoolFile.ifEmpty {
                    store.fetchSchoolIndex().firstOrNull { it.id == selected }?.file ?: ""
                }
                if (file.isNotEmpty()) {
                    store.schoolFile = file
                    val fresh = store.refreshSchool(file)
                    if (fresh != null) {
                        withContext(Dispatchers.Main) { snapshot = fresh.first }
                    }
                }
            } else {
                val fresh = store.refresh()
                if (fresh != null) {
                    val (snap, label) = fresh
                    val current = snapshot?.generatedAt ?: ""
                    if (snap.generatedAt > current) {
                        withContext(Dispatchers.Main) {
                            snapshot = snap
                            toast = "已更新 ${snap.items.size} 条（$label）"
                        }
                    }
                }
            }
            // 顺带查一次新版本（同一批镜像请求，不额外打扰）
            val remote = store.remoteVersion()
            if (remote != null && compareVersions(remote, store.appVersion()) > 0 && remote != store.dismissedUpdateVersion) {
                withContext(Dispatchers.Main) { updateVersion = remote }
            }
        }
    }

    /** 读学校目录（进"设置 → 学校/学院"时才真的去请求；失败就给内置目录） */
    fun loadSchoolIndex() {
        if (schoolIndex != null || indexLoading) return
        indexLoading = true
        scope.launch {
            val list = withContext(Dispatchers.IO) { store.fetchSchoolIndex() }
            indexLoading = false
            schoolIndex = list
            if (list.isEmpty()) toast = "学校目录取不到，稍后再试"
        }
    }

    /** 切换学校：立刻拉该校数据；失败就保持原样并提示（绝不清空已有通知） */
    fun switchSchool(school: SchoolInfo) {
        val file = school.file ?: return
        scope.launch {
            refreshing = true
            val fresh = withContext(Dispatchers.IO) { store.refreshSchool(file) }
            refreshing = false
            if (fresh == null) {
                toast = "「${school.name}」的数据暂时取不到（镜像/网络问题），仍显示原来的通知"
                return@launch
            }
            store.schoolId = school.id
            store.schoolFile = file
            schoolId = school.id
            snapshot = fresh.first
            sourceFilter = null
            toast = "已切换到 ${school.name}" + if (units.isEmpty()) "（还没勾选学院）" else "（已选 ${units.size} 个学院）"
        }
    }

    LaunchedEffect(toast) {
        if (toast != null) {
            kotlinx.coroutines.delay(2400)
            toast = null
        }
    }

    val dark = store.themeOverride ?: isSystemInDarkTheme()

    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                bottomBar = {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                        val tabs = listOf("📋 通知", "⭐ 收藏", "📊 统计", "⚙️ 设置")
                        tabs.forEachIndexed { index, label ->
                            NavigationBarItem(
                                selected = tab == index,
                                onClick = { tab = index; sourceFilter = null },
                                icon = { Text(label.substringBefore(" "), fontSize = 16.sp) },
                                label = { Text(label.substringAfter(" "), fontSize = 11.sp) },
                            )
                        }
                    }
                },
            ) { inner ->
                Column(modifier = Modifier.fillMaxSize().padding(inner)) {
                    AppHeader(
                        title = "校园通知雷达",
                        subtitle = snapshot?.let { "${it.items.size} 条 · 未读 ${it.items.count { n -> n.id !in read }}" } ?: "加载中…",
                        refreshing = refreshing,
                        onToggleTheme = { store.themeOverride = !dark },
                        onRefresh = {
                            scope.launch {
                                refreshing = true
                                // 选过学校就刷新"那所学校"的数据，否则刷新默认数据
                                val file = store.schoolFile
                                val fresh = withContext(Dispatchers.IO) {
                                    if (store.schoolId.isNotEmpty() && file.isNotEmpty()) store.refreshSchool(file) else store.refresh()
                                }
                                refreshing = false
                                if (fresh == null) {
                                    toast = "连不上数据源，继续用本机数据"
                                } else if (store.schoolId.isNotEmpty() && file.isNotEmpty()) {
                                    snapshot = fresh.first
                                    toast = "已更新 ${fresh.first.items.size} 条（${fresh.second}）"
                                } else if (fresh.first.generatedAt > (snapshot?.generatedAt ?: "")) {
                                    snapshot = fresh.first
                                    toast = "已更新 ${fresh.first.items.size} 条（${fresh.second}）"
                                } else {
                                    toast = "已是最新"
                                }
                            }
                        },
                    )

                    when (tab) {
                        0, 1 -> {
                            updateVersion?.let { version ->
                                UpdateBanner(
                                    version = version,
                                    apkUrl = store.apkUrl(),
                                    onDismiss = {
                                        store.dismissedUpdateVersion = version
                                        updateVersion = null
                                    },
                                )
                            }
                            NoticeList(
                                snapshot = snapshot,
                                query = query,
                                onQueryChange = { query = it },
                                sourceFilter = sourceFilter,
                                onSourceFilter = { sourceFilter = it },
                                favOnly = tab == 1,
                                read = read,
                                fav = fav,
                                schoolId = schoolId,
                                units = units,
                                onOpen = { notice ->
                                    read = (read + notice.id).toMutableSet()
                                    store.saveRead(read)
                                    runCatching {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(notice.url)))
                                    }
                                },
                                onToggleFav = { notice ->
                                    fav = (if (notice.id in fav) fav - notice.id else fav + notice.id).toMutableSet()
                                    store.saveFav(fav)
                                },
                            )
                        }
                        2 -> StatsScreen(snapshot)
                        else -> SettingsScreen(
                            store = store,
                            snapshot = snapshot,
                            schoolId = schoolId,
                            schoolName = schoolName,
                            units = units,
                            schoolIndex = schoolIndex,
                            indexLoading = indexLoading,
                            onNeedIndex = { loadSchoolIndex() },
                            onUnitsChange = { next ->
                                units = next
                                store.saveSchoolUnits(next)
                            },
                            onSwitchSchool = { school -> switchSchool(school) },
                            onClearRead = { read = mutableSetOf(); store.saveRead(emptySet()) },
                            onClearFav = { fav = mutableSetOf(); store.saveFav(emptySet()) },
                            onRefreshData = {
                                scope.launch {
                                    refreshing = true
                                    val file = store.schoolFile
                                    val fresh = withContext(Dispatchers.IO) {
                                        if (store.schoolId.isNotEmpty() && file.isNotEmpty()) store.refreshSchool(file) else store.refresh()
                                    }
                                    refreshing = false
                                    if (fresh != null) {
                                        snapshot = fresh.first
                                        toast = "已更新 ${fresh.first.items.size} 条（${fresh.second}）"
                                    } else {
                                        toast = "连不上数据源"
                                    }
                                }
                            },
                            onToast = { toast = it },
                        )
                    }
                }
            }
            toast?.let { msg ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    Text(
                        text = msg,
                        color = MaterialTheme.colorScheme.surface,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .padding(bottom = 96.dp)
                            .background(MaterialTheme.colorScheme.onSurface, RoundedCornerShape(20.dp))
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                    )
                }
            }
        }
    }
}

/** 打开应用就告诉用户有新版本（以前只有进"设置"才看得到，等于没提示）。 */
@Composable
private fun UpdateBanner(version: String, apkUrl: String, onDismiss: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    "发现新版本 v$version",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
                Text(
                    "应用内直接下载安装，收藏与已读不会丢",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                )
            }
            TextButton(onClick = onDismiss) {
                Text("✕", fontSize = 13.sp, color = MaterialTheme.colorScheme.onPrimary)
            }
        }
        InAppUpdateRow(version = version, apkUrl = apkUrl, onPrimary = true)
    }
}

/**
 * 应用内更新：下载 → 调起系统安装器。
 *
 * 为什么要有它：以前点"更新"是打开浏览器去 GitHub 下载，用户得自己找安装包再安装，
 * 于是"一次又一次去 GitHub 装"。现在应用自己下载并直接调起安装器。
 * 注意：Android 不允许静默安装，系统还会让用户点一次「安装」，这一步绕不过去。
 */
@Composable
private fun InAppUpdateRow(version: String, apkUrl: String, onPrimary: Boolean = false) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val handler = remember { android.os.Handler(android.os.Looper.getMainLooper()) }
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(-1) }
    var hint by remember { mutableStateOf<String?>(null) }

    val textColor = if (onPrimary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    val subColor = if (onPrimary) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f) else MaterialTheme.colorScheme.onSurfaceVariant

    Row(verticalAlignment = Alignment.CenterVertically) {
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    busy = true
                    progress = -1
                    hint = "正在下载…"
                    val result = withContext(Dispatchers.IO) {
                        runCatching {
                            // 进度回调来自 IO 线程，切回主线程再写 Compose 状态
                            UpdateInstaller.download(context, apkUrl, version) { pct -> handler.post { progress = pct } }
                        }
                    }
                    busy = false
                    result.fold(
                        onSuccess = { file ->
                            val err = UpdateInstaller.install(context, file)
                            hint = err ?: "已调起系统安装器，点「安装」即可覆盖升级"
                        },
                        onFailure = { e ->
                            hint = (e.message ?: "下载失败") + "。可点右边用浏览器打开下载"
                        },
                    )
                }
            },
        ) {
            Text(
                when {
                    busy && progress >= 0 -> "下载中 $progress%"
                    busy -> "下载中…"
                    else -> "应用内更新"
                },
                fontSize = 13.sp,
            )
        }
        Spacer(Modifier.width(8.dp))
        TextButton(onClick = { openUrl(context, apkUrl) }) {
            Text("浏览器打开", fontSize = 12.5.sp, color = if (onPrimary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary)
        }
    }
    hint?.let {
        Text(it, fontSize = 11.sp, color = subColor)
    }
    Text(
        "如果下载慢：GitHub 在国内时快时慢，可稍后重试或用「浏览器打开」",
        fontSize = 10.5.sp,
        color = subColor,
    )
}

@Composable
private fun AppHeader(
    title: String,
    subtitle: String,
    refreshing: Boolean,
    onToggleTheme: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.width(8.dp))
        Text(subtitle, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        // 与网页版一致：顶栏一个按钮，点一下就切深浅色（不再是设置里的开关）
        TextButton(onClick = onToggleTheme) {
            Text("◐", fontSize = 17.sp)
        }
        TextButton(onClick = onRefresh, enabled = !refreshing) {
            Text(if (refreshing) "刷新中…" else "刷新", fontSize = 13.sp)
        }
    }
}

// ---------------------------------------------------------------- 通知列表

private sealed interface Entry {
    data class Day(val date: String, val count: Int) : Entry
    data class Item(val notice: Notice) : Entry
}

@Composable
private fun NoticeList(
    snapshot: Snapshot?,
    query: String,
    onQueryChange: (String) -> Unit,
    sourceFilter: String?,
    onSourceFilter: (String?) -> Unit,
    favOnly: Boolean,
    read: Set<String>,
    fav: Set<String>,
    schoolId: String,
    units: Set<String>,
    onOpen: (Notice) -> Unit,
    onToggleFav: (Notice) -> Unit,
) {
    val all = snapshot?.items ?: emptyList()
    val sources = snapshot?.bySource ?: emptyList()

    // 过滤规则全在 filterNotices（纯函数，有 JVM 单测钉住"选了学校却没勾学院 = 什么都不显示"）
    val filtered = remember(all, query, sourceFilter, favOnly, fav, schoolId, units) {
        filterNotices(all, query, sourceFilter, favOnly, fav, schoolId, units)
    }

    val rows = remember(filtered) {
        val out = mutableListOf<Entry>()
        filtered.groupBy { it.date.ifEmpty { "日期未知" } }.forEach { (date, list) ->
            out += Entry.Day(date, list.size)
            list.forEach { out += Entry.Item(it) }
        }
        out
    }

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            placeholder = { Text("搜索标题，例如：退课 / 四六级 / 推免", fontSize = 13.sp) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        )

        if (!favOnly) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                FilterChip(text = "全部 ${all.size}", active = sourceFilter == null) { onSourceFilter(null) }
                sources.forEach { s ->
                    FilterChip(text = "${s.sourceName} ${s.count}", active = sourceFilter == s.sourceId) {
                        onSourceFilter(s.sourceId)
                    }
                }
            }
        }

        if (rows.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    when {
                        // 选过学校但一个学院都没勾：这是产品要求的默认状态，必须说清楚去哪儿勾
                        schoolId.isNotEmpty() && units.isEmpty() ->
                            "请选择你关心的学院：设置 → 学校 / 学院 → 勾选后这里就会显示该学院的通知。"
                        favOnly -> "还没有收藏，点通知卡片右下角的 ☆"
                        else -> "没有匹配的通知"
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
            return
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            rows.forEach { row ->
                when (row) {
                    is Entry.Day -> item(key = "day-${row.date}") {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                            Text(row.date, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "${row.count} 条",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier
                                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp))
                                    .padding(horizontal = 8.dp, vertical = 1.dp),
                            )
                        }
                    }
                    is Entry.Item -> item(key = row.notice.id) {
                        NoticeCard(
                            notice = row.notice,
                            isRead = row.notice.id in read,
                            isFav = row.notice.id in fav,
                            onOpen = { onOpen(row.notice) },
                            onToggleFav = { onToggleFav(row.notice) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(text: String, active: Boolean, onClick: () -> Unit) {
    Text(
        text = text,
        fontSize = 12.5.sp,
        color = if (active) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .background(
                if (active) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.surface,
                RoundedCornerShape(20.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun NoticeCard(notice: Notice, isRead: Boolean, isFav: Boolean, onOpen: () -> Unit, onToggleFav: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            // 未读左侧色条
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(56.dp)
                    .padding(top = 10.dp)
                    .background(if (isRead) Color.Transparent else MaterialTheme.colorScheme.primary),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onOpen() }
                    .padding(start = 10.dp, top = 11.dp, bottom = 11.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        notice.sourceName,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(5.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    notice.tag?.let { tag ->
                        Text(
                            tag,
                            fontSize = 11.sp,
                            color = Color.White,
                            modifier = Modifier
                                .background(tagColor(tag), RoundedCornerShape(5.dp))
                                .padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        notice.title,
                        fontSize = 14.5.sp,
                        lineHeight = 21.sp,
                        color = if (isRead) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            TextButton(onClick = onToggleFav, modifier = Modifier.padding(end = 2.dp)) {
                Text(if (isFav) "★" else "☆", fontSize = 20.sp, color = if (isFav) Color(0xFFF59F00) else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ---------------------------------------------------------------- 统计

@Composable
private fun StatsScreen(snapshot: Snapshot?) {
    val items = snapshot?.items ?: emptyList()
    val now = System.currentTimeMillis()
    val dayMs = 86400000L

    val perDay = remember(items) {
        items.groupBy { it.firstSeenAt.take(10) }.mapValues { it.value.size }
    }
    val recent7 = items.count { it.firstSeenAt.isNotEmpty() && parseTime(it.firstSeenAt) >= now - 7 * dayMs }
    val recent30 = items.count { it.firstSeenAt.isNotEmpty() && parseTime(it.firstSeenAt) >= now - 30 * dayMs }
    val busiest = perDay.maxByOrNull { it.value }
    val tags = remember(items) { items.mapNotNull { it.tag }.groupingBy { it }.eachCount().toList().sortedByDescending { it.second } }
    val weekdays = remember(items) {
        val arr = IntArray(7)
        items.forEach { n ->
            if (n.firstSeenAt.isNotEmpty()) {
                val cal = Calendar.getInstance()
                cal.timeInMillis = parseTime(n.firstSeenAt)
                arr[cal.get(Calendar.DAY_OF_WEEK) - 1]++
            }
        }
        arr.toList()
    }
    val trend = remember(items) {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val days = (13 downTo 0).map { fmt.format(Date(now - it * dayMs)) }
        days.map { d -> d to items.count { it.firstSeenAt.take(10) == d } }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SettingsCard(title = "总览") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatBox("${items.size}", "累计归档", Modifier.weight(1f))
                        StatBox("$recent7", "最近 7 天", Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatBox("$recent30", "最近 30 天", Modifier.weight(1f))
                        StatBox("${perDay.size} 天", "有新增的天数", Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatBox(busiest?.let { "${it.value}" } ?: "0", busiest?.let { "单日最多（${it.key}）" } ?: "单日最多", Modifier.weight(1f))
                        StatBox("${snapshot?.bySource?.size ?: 0}", "覆盖来源", Modifier.weight(1f))
                    }
                }
            }
        }
        item {
            SettingsCard(title = "最近 14 天发现量") {
                BarRow(labels = trend.map { it.first.takeLast(2) }, values = trend.map { it.second })
            }
        }
        item {
            SettingsCard(title = "按来源") {
                BarList(snapshot?.bySource?.map { it.sourceName to it.count } ?: emptyList())
            }
        }
        item {
            SettingsCard(title = "按标签") {
                BarList(tags.map { it.first to it.second })
            }
        }
        item {
            SettingsCard(title = "星期分布（学校习惯哪天发通知）") {
                val names = listOf("日", "一", "二", "三", "四", "五", "六")
                BarRow(labels = names, values = weekdays)
            }
        }
    }
}

private fun parseTime(iso: String): Long = try {
    // 形如 2026-09-28T12:00:00.000Z
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
    fmt.parse(iso)?.time ?: 0L
} catch (e: Exception) {
    0L
}

@Composable
private fun StatBox(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(value, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun BarRow(labels: List<String>, values: List<Int>) {
    val max = (values.maxOrNull() ?: 1).coerceAtLeast(1)
    Row(
        modifier = Modifier.fillMaxWidth().height(96.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val v = values.getOrElse(i) { 0 }
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height((72 * (v.toFloat() / max)).coerceAtLeast(2f).dp)
                        .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)),
                )
                Spacer(Modifier.height(4.dp))
                Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BarList(rows: List<Pair<String, Int>>) {
    if (rows.isEmpty()) {
        Text("还没有数据", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val max = (rows.maxOfOrNull { it.second } ?: 1).coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { (name, count) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    fontSize = 12.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.width(120.dp),
                )
                Spacer(Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(9.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(count.toFloat() / max)
                            .height(9.dp)
                            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(20.dp)),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text("$count", fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

// ---------------------------------------------------------------- 设置

/** 用系统浏览器打开链接（应用内不做 WebView，避免额外的权限与风险） */
private fun openUrl(context: android.content.Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}

/** 设置里的一行"可点外链"：标题 + 说明 + 右箭头 */
@Composable
private fun LinkRow(title: String, hint: String, onOpen: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onOpen() }.padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 13.5.sp, color = MaterialTheme.colorScheme.primary)
            Text(hint, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("›", fontSize = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(title, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

// ---------------------------------------------------------------- 学校 / 学院选择

/**
 * 学院 chips 的换行排版：按估算宽度贪心分行。
 * 刻意不用 FlowRow（实验 API）：这里数据量很小、估算够用，少一个编译期风险点。
 */
private fun unitRows(units: List<SchoolUnit>, maxWidth: Int = 300): List<List<SchoolUnit>> {
    val rows = mutableListOf<MutableList<SchoolUnit>>()
    var width = 0
    for (u in units) {
        // 中文按 13dp/字估宽，再加左右内边距与条目数
        val w = 30 + u.name.length * 13 + (if (u.count > 0) 26 else 0)
        if (rows.isEmpty() || (width > 0 && width + w > maxWidth)) {
            rows.add(mutableListOf())
            width = 0
        }
        rows.last().add(u)
        width += w + 6
    }
    return rows
}

/** 学校目录里的一行：校名 + 城市 + 已接入/待接入（待接入只解释，不假装能切） */
@Composable
private fun SchoolOptionRow(school: SchoolInfo, selected: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
                RoundedCornerShape(10.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                school.name,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (school.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (school.city.isNotEmpty()) {
                Spacer(Modifier.width(6.dp))
                Text(school.city, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(
            if (school.active) "已接入" + (if (school.total > 0) " · ${school.total} 条" else "") else "待接入",
            fontSize = 11.sp,
            color = if (school.active) Color(0xFF2F9E44) else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * 设置里的「学校 / 学院」卡片，与网页端设置里那一套流程一致：
 *   搜索学校 → 选一所（pending）→ 勾选学院（可多选，默认全不选）→ 确认切换（弹窗二次确认）。
 *
 * 目录与该校数据都由上层取（onNeedIndex / onSwitchSchool），这里只管界面自己的临时状态
 * （是否展开、搜索词、待确认学校）；偏好改动立刻上抛保存，切走应用也不丢。
 */
@Composable
private fun SchoolPickerCard(
    schoolId: String,
    schoolName: String,
    units: Set<String>,
    schoolIndex: List<SchoolInfo>?,
    indexLoading: Boolean,
    onNeedIndex: () -> Unit,
    onUnitsChange: (Set<String>) -> Unit,
    onSwitchSchool: (SchoolInfo) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    // 点目录里的学校只是"预备选定"，勾完学院再确认切换（与网页端一致）
    var pending by remember { mutableStateOf<SchoolInfo?>(null) }
    var asking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    // 学院面板优先跟着"待确认的学校"；没有待确认的就跟着当前学校（老用户也能补勾学院）
    val viewing = pending ?: schoolIndex?.firstOrNull { it.id == schoolId }

    SettingsCard(title = "学校 / 学院") {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        if (schoolId.isEmpty()) {
                            "未选择（正在显示默认学校）"
                        } else {
                            "当前：$schoolName" + (if (units.isEmpty()) "（还没勾选学院）" else "（已选 ${units.size} 个学院）")
                        },
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "切换后列表只显示该校数据；学院默认全不选（勾了才显示）",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = {
                    open = !open
                    if (open) onNeedIndex()
                }) { Text(if (open) "收起" else "选择", fontSize = 13.sp) }
            }

            if (open) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("搜索学校：校名 / 城市 / 拼音 / 简称", fontSize = 13.sp) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))

                val list = schoolIndex
                if (list == null) {
                    Text(
                        if (indexLoading) "正在取学校目录…" else "学校目录取不到（镜像/网络问题），稍后再试",
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    val hit = searchSchools(list, query)
                    if (hit.isEmpty()) {
                        Text(
                            "没找到匹配的学校。可试试校名、城市或拼音（例如 dianzi、成都）",
                            fontSize = 12.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    hit.forEach { s ->
                        SchoolOptionRow(
                            school = s,
                            selected = s.id == pending?.id,
                            onClick = {
                                if (s.active) {
                                    pending = s
                                    note = "已选「${s.name}」。勾选你关心的学院，然后点下面的「确认切换」。"
                                } else {
                                    // 待接入的必须说清楚为什么不能选，否则用户以为应用坏了
                                    note = "「${s.name}」还没有接入：需要有该校栏目的配置才能抓取。" +
                                        "接入方法见仓库 docs/add-your-school.md。"
                                }
                            },
                        )
                    }
                }

                viewing?.let { s ->
                    if (s.units.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "${s.name} · 学院 / 栏目",
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text("默认全不选，勾选你关心的（可多选）", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        unitRows(s.units).forEach { row ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 6.dp),
                            ) {
                                row.forEach { u ->
                                    FilterChip(
                                        text = if (u.count > 0) "${u.name} ${u.count}" else u.name,
                                        active = u.name in units,
                                        onClick = {
                                            onUnitsChange(if (u.name in units) units - u.name else units + u.name)
                                        },
                                    )
                                    Spacer(Modifier.width(6.dp))
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = { onUnitsChange(s.units.map { it.name }.toSet()) }) {
                                Text("全选", fontSize = 12.5.sp)
                            }
                            TextButton(onClick = { onUnitsChange(emptySet()) }) {
                                Text("全不选", fontSize = 12.5.sp)
                            }
                        }
                    } else if (s.active) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "这所学校没有学院/栏目数据，选中后直接显示该校全部通知。",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                note?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, fontSize = 11.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                val ready = pending
                if (ready != null && ready.active) {
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { asking = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("确认切换到「${ready.name}」", fontSize = 13.sp)
                    }
                }
            }
        }
    }

    // 二次确认：切换会立刻换掉整个列表，不能点一下就当切了
    val target = pending
    if (asking && target != null) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text("切换到「${target.name}」？", fontSize = 15.sp) },
            text = {
                val unitText = if (units.isEmpty()) {
                    "（还没勾选学院，列表会提示你先勾选）"
                } else {
                    "（已选 ${units.size} 个学院：${units.joinToString("、")}）"
                }
                Text("将立即刷新为该学校的通知" + unitText, fontSize = 13.sp)
            },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    onSwitchSchool(target)
                    pending = null
                    note = null
                    open = false
                    query = ""
                }) { Text("确认切换") }
            },
            dismissButton = {
                TextButton(onClick = { asking = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun SettingsScreen(
    store: Store,
    snapshot: Snapshot?,
    schoolId: String,
    schoolName: String,
    units: Set<String>,
    schoolIndex: List<SchoolInfo>?,
    indexLoading: Boolean,
    onNeedIndex: () -> Unit,
    onUnitsChange: (Set<String>) -> Unit,
    onSwitchSchool: (SchoolInfo) -> Unit,
    onClearRead: () -> Unit,
    onClearFav: () -> Unit,
    onRefreshData: () -> Unit,
    onToast: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var pushEnabled by remember { mutableStateOf<Boolean?>(null) }
    var pushHint by remember { mutableStateOf("读取中…") }
    var tokenInput by remember { mutableStateOf("") }
    var hasToken by remember { mutableStateOf(store.githubToken.isNotEmpty()) }
    // 微信推送：绑定引导 + 当场验证
    var testHint by remember { mutableStateOf<String?>(null) }
    var lastLog by remember { mutableStateOf<NotifyLog?>(null) }
    var remoteVersion by remember { mutableStateOf<String?>(null) }
    var versionHint by remember { mutableStateOf("点右侧按钮检查线上版本") }
    var busy by remember { mutableStateOf(false) }

    fun loadPush() {
        scope.launch {
            val state = withContext(Dispatchers.IO) { store.fetchPushEnabled() }
            pushEnabled = state
            pushHint = when {
                state == true -> "微信推送：已开启"
                state == false -> "微信推送：已关闭"
                hasToken -> "微信推送：读取失败（令牌权限或网络）"
                else -> "微信推送：默认开启（设置令牌后可在这里开关）"
            }
        }
    }

    LaunchedEffect(hasToken) {
        loadPush()
        if (hasToken) lastLog = withContext(Dispatchers.IO) { store.lastNotifyLog() }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 学校 / 学院（选校功能；放在最前面，因为"看哪所学校"决定了下面一切）
        item {
            SchoolPickerCard(
                schoolId = schoolId,
                schoolName = schoolName,
                units = units,
                schoolIndex = schoolIndex,
                indexLoading = indexLoading,
                onNeedIndex = onNeedIndex,
                onUnitsChange = onUnitsChange,
                onSwitchSchool = onSwitchSchool,
            )
        }

        // 微信推送
        item {
            SettingsCard(title = "微信推送") {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(pushHint, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.height(2.dp))
                            Text("开关即仓库变量 PUSH_ENABLED；关掉后云端连抓取都跳过", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = pushEnabled == true,
                            enabled = pushEnabled != null && !busy,
                            onCheckedChange = { next ->
                                scope.launch {
                                    busy = true
                                    val err = withContext(Dispatchers.IO) { store.setPushEnabled(next) }
                                    busy = false
                                    if (err == null) {
                                        pushEnabled = next
                                        pushHint = if (next) "微信推送：已开启" else "微信推送：已关闭"
                                        onToast(if (next) "已开启微信推送" else "已关闭微信推送")
                                    } else {
                                        onToast("设置失败：$err")
                                    }
                                }
                            },
                        )
                    }

                    // ── 绑定步骤：微信扫码授权 → 关注服务号 → 填密钥 → 当场验证 ──
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "绑定步骤（只需做一次）",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    LinkRow(
                        title = "① 微信扫码授权 · 关注服务号",
                        hint = "打开后扫码登录，并关注它的服务号（不关注就收不到消息），复制页面上的 SendKey",
                        onOpen = { openUrl(context, SERVERCHAN_URL) },
                    )
                    LinkRow(
                        title = "② 把 SendKey 存成仓库 Secret",
                        hint = "Name 必须填 SERVERCHAN_KEY，Secret 粘贴上一步的 SendKey；存好即生效",
                        onOpen = { openUrl(context, SECRET_SETUP_URL) },
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Button(
                            enabled = !busy,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    val before = lastLog?.at ?: ""
                                    testHint = "已触发测试推送，等待结果…"
                                    val err = withContext(Dispatchers.IO) { store.triggerNotifyTest() }
                                    if (err != null) {
                                        busy = false
                                        testHint = "触发失败：$err"
                                    } else {
                                        // 工作流跑完会把 data/last-notify.json 提交回仓库，轮询读回来
                                        var log: NotifyLog? = null
                                        for (i in 1..9) {
                                            kotlinx.coroutines.delay(10_000)
                                            val fresh = withContext(Dispatchers.IO) { store.lastNotifyLog() }
                                            if (fresh != null && fresh.at != before) {
                                                log = fresh
                                                break
                                            }
                                        }
                                        busy = false
                                        lastLog = log ?: lastLog
                                        testHint = when {
                                            log == null -> "还没读到新结果（工作流可能还在跑，稍后点「查看最近结果」）"
                                            log.deliveredRemotely -> "✓ 推送成功：${log.summary}（${log.count} 条）"
                                            else -> "✗ 推送失败：${log.summary} —— 看下面各通道详情"
                                        }
                                    }
                                }
                            },
                        ) { Text("测试推送", fontSize = 13.sp) }
                        Spacer(Modifier.width(8.dp))
                        TextButton(
                            enabled = !busy,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    val log = withContext(Dispatchers.IO) { store.lastNotifyLog() }
                                    lastLog = log
                                    busy = false
                                    testHint = if (log == null) {
                                        "读不到推送记录（令牌需有 Contents: read 权限，或还没跑过测试）"
                                    } else {
                                        "已读取最近一次结果"
                                    }
                                }
                            },
                        ) { Text("查看最近结果", fontSize = 13.sp) }
                    }
                    testHint?.let { hint ->
                        Spacer(Modifier.height(6.dp))
                        Text(hint, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface)
                    }
                    lastLog?.let { log ->
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "最近一次：${log.summary} · ${log.title}（${log.count} 条）· ${log.at.replace("T", " ").take(16)} UTC",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        for (o in log.outcomes.filter { it.channel != "stdout" }) {
                            Text(
                                "· ${o.channel}：${if (o.ok) "成功" else "失败"} ${o.detail.take(70)}",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(10.dp))
                    if (hasToken) {
                        Text("令牌已保存在本机（只用于改这一个仓库变量）", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        Row {
                            TextButton(onClick = {
                                store.githubToken = ""
                                hasToken = false
                                pushEnabled = null
                                onToast("已清除本机令牌")
                            }) { Text("清除令牌", fontSize = 13.sp) }
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = { loadPush() }) { Text("重新读取", fontSize = 13.sp) }
                        }
                    } else {
                        Text(
                            "要在应用里开关推送、跑「测试推送」并读回结果，需要一个 fine-grained 令牌：" +
                                "只授权本仓库，权限勾 Variables: Read and write、Actions: Read and write、Contents: Read。" +
                                "令牌只存在这台设备，不上传。",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = tokenInput,
                            onValueChange = { tokenInput = it },
                            singleLine = true,
                            placeholder = { Text("粘贴令牌", fontSize = 13.sp) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(6.dp))
                        Row {
                            Button(onClick = {
                                if (tokenInput.isBlank()) {
                                    onToast("请先粘贴令牌")
                                } else {
                                    store.githubToken = tokenInput.trim()
                                    tokenInput = ""
                                    hasToken = true
                                    onToast("令牌已保存在本机")
                                }
                            }) { Text("保存", fontSize = 13.sp) }
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/settings/personal-access-tokens/new")))
                                }
                            }) { Text("去创建令牌", fontSize = 13.sp) }
                        }
                    }
                }
            }
        }

        // 应用更新
        item {
            SettingsCard(title = "应用更新") {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("当前版本 v${store.appVersion()}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.height(2.dp))
                            Text(versionHint, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(
                            enabled = !busy,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    versionHint = "检查中…"
                                    val remote = withContext(Dispatchers.IO) { store.remoteVersion() }
                                    busy = false
                                    remoteVersion = remote
                                    versionHint = when {
                                        remote == null -> "连不上版本服务器（离线也能正常用）"
                                        // 必须按数字比较：字符串比较会把 0.10.3 当成比 0.8.0 旧（老 bug）
                                        compareVersions(remote, store.appVersion()) > 0 -> "发现新版本 v$remote"
                                        else -> "已是最新（检查时间 ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())}）"
                                    }
                                }
                            },
                        ) { Text("检查更新", fontSize = 13.sp) }
                    }
                    val remote = remoteVersion
                    if (remote != null && compareVersions(remote, store.appVersion()) > 0) {
                        Spacer(Modifier.height(8.dp))
                        InAppUpdateRow(version = remote, apkUrl = store.apkUrl())
                    }
                }
            }
        }

        // 数据
        item {
            SettingsCard(title = "通知数据") {
                Column {
                    Text(
                        "${snapshot?.items?.size ?: 0} 条 · 数据时间 ${snapshot?.generatedAt?.replace("T", " ")?.take(16) ?: "-"} UTC",
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        if (schoolId.isNotEmpty()) {
                            "来源：$schoolName 的学校数据 · ${store.schoolSource().ifEmpty { "本机缓存" }}（打开应用不联网，联网时按镜像自动刷新）"
                        } else {
                            "来源：${store.dataSource}（打开应用不联网，联网时按镜像自动刷新）"
                        },
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row {
                        Button(onClick = onRefreshData, enabled = !busy) { Text("立即刷新", fontSize = 13.sp) }
                        Spacer(Modifier.width(10.dp))
                        TextButton(onClick = onClearRead) { Text("清除已读", fontSize = 13.sp) }
                        TextButton(onClick = onClearFav) { Text("清除收藏", fontSize = 13.sp) }
                    }
                }
            }
        }

        // 关于（注意：应用内不出现"安装到手机"的引导，那是给网页版访客看的）
        item {
            SettingsCard(title = "关于") {
                Column {
                    Text(
                        "这是 Android 原生应用：界面与当前数据都打包在应用内，打开不需要联网，也不会跳浏览器。",
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        lineHeight = 19.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "数据由 notice-radar 定时抓取（只抓公开页面、不登录、不存个人信息），" +
                            "站点结构变更可能导致漏抓，请以学校官网原文为准。",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/$REPO_SLUG")))
                        }
                    }) { Text("打开项目主页", fontSize = 13.sp) }
                }
            }
        }
    }
}

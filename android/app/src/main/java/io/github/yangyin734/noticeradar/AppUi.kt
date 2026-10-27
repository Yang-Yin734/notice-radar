package io.github.yangyin734.noticeradar

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.yangyin734.noticeradar.ui.AppColors
import io.github.yangyin734.noticeradar.ui.AppTypography
import io.github.yangyin734.noticeradar.ui.DarkScheme
import io.github.yangyin734.noticeradar.ui.Hairline
import io.github.yangyin734.noticeradar.ui.LightScheme
import io.github.yangyin734.noticeradar.ui.Shape
import io.github.yangyin734.noticeradar.ui.Space
import io.github.yangyin734.noticeradar.ui.Type
import io.github.yangyin734.noticeradar.ui.tagColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// ---------------------------------------------------------------- 主题
//
// 色板 / 字阶 / 圆角 / 间距 / 图标全部迁到 ui/Tokens.kt（设计令牌），这里不再定义任何色值。
// 改 UI 前先读那个文件顶部的硬规则：1 个强调色、5 级字阶、3 个圆角、0 阴影只看描边。

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
    // 深浅色必须放在 Compose 的可观察状态里：以前直接读 store.themeOverride（SharedPreferences 的
    // 普通属性），写进去不会触发重组，于是"点了没反应、得再按一下刷新"才看到变化。
    var darkOverride by remember { mutableStateOf(store.themeOverride) }
    // 首次使用提示：本次打开里点过"知道了"就收起
    var hintDone by remember { mutableStateOf(false) }
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

    val dark = darkOverride ?: isSystemInDarkTheme()

    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        typography = AppTypography,
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                bottomBar = {
                    // 底栏与页面同色、只用一条细线隔开：纸的页脚不会自带一块灰色。
                    Column(Modifier.background(AppColors.bg)) {
                        Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
                        NavigationBar(
                            containerColor = AppColors.bg,
                            tonalElevation = 0.dp,
                        ) {
                        // 图标必须是矢量而不是 emoji：不同 ROM 的 emoji 字形完全不同，
                        // 而且"找不到图标就先塞个 emoji"本身就是没做过设计的标志。
                        val tabs = listOf(
                            "通知" to R.drawable.ic_notice,
                            "收藏" to R.drawable.ic_star_outline,
                            "统计" to R.drawable.ic_chart,
                            "设置" to R.drawable.ic_settings,
                        )
                        tabs.forEachIndexed { index, (label, iconRes) ->
                            NavigationBarItem(
                                selected = tab == index,
                                onClick = { tab = index; sourceFilter = null },
                                icon = {
                                    Icon(
                                        painter = painterResource(iconRes),
                                        contentDescription = null,
                                        modifier = Modifier.size(22.dp),
                                    )
                                },
                                label = { Text(label, style = Type.micro) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = AppColors.accent,
                                    selectedTextColor = AppColors.accent,
                                    indicatorColor = Color.Transparent,
                                    unselectedIconColor = AppColors.muted,
                                    unselectedTextColor = AppColors.muted,
                                ),
                            )
                        }
                        }
                    }
                },
            ) { inner ->
                Column(modifier = Modifier.fillMaxSize().padding(inner)) {
                    AppHeader(
                        title = "校园通知雷达",
                        subtitle = snapshot?.let { "${it.items.size} 条 · 未读 ${it.items.count { n -> n.id !in read }}" } ?: "加载中…",
                        refreshing = refreshing,
                        dark = dark,
                        // 一次点击立刻重组：改状态 + 落盘各一次
                        onToggleTheme = {
                            val next = !dark
                            darkOverride = next
                            store.themeOverride = next
                        },
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
                            // 第一次打开（没选过学校、也一条都没读过）先告诉用户"这是哪所学校、去哪儿换"
                            if (tab == 0 && !hintDone && schoolId.isEmpty() && read.isEmpty()) {
                                FirstRunHint(
                                    onPickSchool = {
                                        hintDone = true
                                        tab = 3
                                        loadSchoolIndex()
                                    },
                                    onDismiss = { hintDone = true },
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
                        style = Type.label,
                        color = AppColors.paper,
                        modifier = Modifier
                            .padding(bottom = 96.dp)
                            .clip(Shape.control)
                            .background(AppColors.ink)
                            .padding(horizontal = Space.item, vertical = Space.s),
                    )
                }
            }
        }
    }
}

/**
 * 打开应用就告诉用户有新版本（以前只有进"设置"才看得到，等于没提示）。
 *
 * 不用整块主色铺底：顶部一条主色底的通知带就够显眼，铺满会盖住"这是通知应用"的第一印象。
 */
@Composable
private fun UpdateBanner(version: String, apkUrl: String, onDismiss: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.page, vertical = Space.s)
            .clip(Shape.card)
            .background(AppColors.accentSoft)
            .padding(start = Space.m, end = Space.xs, top = 10.dp, bottom = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("发现新版本 v$version", style = Type.label, color = AppColors.accent)
                Text("应用内下载安装，收藏与已读不会丢", style = Type.micro, color = AppColors.ink2)
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(34.dp)) {
                Icon(
                    painter = painterResource(R.drawable.ic_close),
                    contentDescription = "关闭",
                    modifier = Modifier.size(16.dp),
                    tint = AppColors.ink2,
                )
            }
        }
        InAppUpdateRow(version = version, apkUrl = apkUrl, onPrimary = false)
    }
}

/**
 * 首次使用提示：现在显示的是哪所学校、去哪儿换成自己的学校。
 * 选过学校或者读过一条通知之后这条就不再出现（不需要额外存偏好）。
 */
@Composable
private fun FirstRunHint(onPickSchool: () -> Unit, onDismiss: () -> Unit) {
    // 一条横向提示带：不用灰底方块，靠上下两条细线把它和内容分开，像公告栏上的临时通知
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.page)
            .padding(top = Space.s, bottom = Space.xs)
            .clip(Shape.card)
            .background(AppColors.sunken)
            .padding(start = Space.m, end = Space.xs, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("先选你的学校", style = Type.label, color = AppColors.ink)
            Spacer(Modifier.height(2.dp))
            Text(
                "当前是电子科技大学；选完只显示你们学校的通知。",
                style = Type.micro,
                color = AppColors.muted,
            )
        }
        TextButton(onClick = onPickSchool) { Text("去选", style = Type.label, color = AppColors.accent) }
        IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_close),
                contentDescription = "关闭提示",
                modifier = Modifier.size(14.dp),
                tint = AppColors.muted,
            )
        }
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
                style = Type.label,
            )
        }
        Spacer(Modifier.width(Space.s))
        TextButton(onClick = { openUrl(context, apkUrl) }) {
            Text("浏览器打开", style = Type.label, color = if (onPrimary) MaterialTheme.colorScheme.onPrimary else AppColors.accent)
        }
    }
    hint?.let {
        Text(it, style = Type.micro, color = subColor)
    }
    Text(
        "下载慢多半是 GitHub 线路问题，可稍后重试或改用「浏览器打开」",
        style = Type.micro,
        color = subColor,
    )
}

@Composable
private fun AppHeader(
    title: String,
    subtitle: String,
    refreshing: Boolean,
    dark: Boolean,
    onToggleTheme: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = Space.page, end = Space.xs, top = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 标题与计数分两行：挤在一行时右侧两个按钮会把标题挤成"工具软件"的排版
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = Type.title, color = AppColors.ink)
            Spacer(Modifier.height(2.dp))
            Text(
                if (refreshing) "正在刷新…" else subtitle,
                style = Type.micro,
                color = AppColors.muted,
            )
        }
        IconButton(onClick = onToggleTheme, modifier = Modifier.size(40.dp)) {
            Icon(
                painter = painterResource(if (dark) R.drawable.ic_sun else R.drawable.ic_moon),
                contentDescription = if (dark) "切换到浅色" else "切换到深色",
                modifier = Modifier.size(20.dp),
                tint = AppColors.ink2,
            )
        }
        IconButton(onClick = onRefresh, enabled = !refreshing, modifier = Modifier.size(40.dp)) {
            Icon(
                painter = painterResource(R.drawable.ic_refresh),
                contentDescription = "刷新",
                modifier = Modifier.size(20.dp),
                tint = if (refreshing) AppColors.muted else AppColors.ink2,
            )
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
        // 搜索框去掉 Material 的圆角描边框：报纸的检索入口就是「一行字 + 一条下划线」
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            textStyle = Type.body.copy(color = AppColors.ink),
            cursorBrush = SolidColor(AppColors.accent),
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.page, vertical = Space.s),
            decorationBox = { inner ->
                Column {
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (query.isEmpty()) {
                            Text(
                                "搜索标题，例如：退课 / 四六级 / 推免",
                                style = Type.body,
                                color = AppColors.muted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        inner()
                    }
                    Spacer(Modifier.height(Space.s))
                    Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
                }
            },
        )

        if (!favOnly) {
            // 来源切换是"换一页报纸"，不是给列表打标签：下划线 tab + 通栏细线，不用药丸
            Column(Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                        .padding(start = Space.page, end = Space.page),
                    horizontalArrangement = Arrangement.spacedBy(Space.page),
                ) {
                    NavTab(text = "全部", count = all.size, active = sourceFilter == null) { onSourceFilter(null) }
                    sources.forEach { s ->
                        NavTab(text = s.sourceName, count = s.count, active = sourceFilter == s.sourceId) {
                            onSourceFilter(s.sourceId)
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
            }
        }

        if (rows.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                // 空态 = 一句话说清状态 + 一句话说清下一步。以前把 40 字的操作指引用正文塞进来，
                // 等于把说明书当成了界面。
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        when {
                            schoolId.isNotEmpty() && units.isEmpty() -> "还没勾选学院"
                            favOnly -> "收藏夹是空的"
                            else -> "没有匹配的通知"
                        },
                        style = Type.body,
                        color = AppColors.ink2,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        when {
                            schoolId.isNotEmpty() && units.isEmpty() -> "在「设置 · 学校 / 学院」里勾选你关心的学院"
                            favOnly -> "在通知卡片右上角点星标就能收藏"
                            else -> "换个关键词，或清掉来源筛选"
                        },
                        style = Type.micro,
                        color = AppColors.muted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 32.dp),
                    )
                }
            }
            return
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = Space.page, end = Space.page, top = 2.dp, bottom = Space.group),
            // 条目之间靠横线分隔，不靠留白 + 卡片：留白是卡片时代的呼吸，横线才是列表的分隔
            verticalArrangement = Arrangement.Top,
        ) {
            rows.forEach { row ->
                when (row) {
                    is Entry.Day -> item(key = "day-${row.date}") {
                        // 日期是这一页的骨架：左边日期、右边条数、下面一条通栏细线。不加底色、不加药丸。
                        Column(Modifier.padding(top = Space.group)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth().padding(bottom = 7.dp),
                            ) {
                                Text(
                                    dayLabel(row.date),
                                    style = Type.label,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AppColors.ink,
                                )
                                Spacer(Modifier.weight(1f))
                                Text("${row.count} 条", style = Type.micro, color = AppColors.muted)
                            }
                            Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
                        }
                    }
                    is Entry.Item -> item(key = row.notice.id) {
                        NoticeRow(
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
    // 筛选是"过滤条件"不是"主操作"：选中态用墨色细描边 + 文字加粗，不用整块深色药丸抢走注意力
    Text(
        text = text,
        style = Type.micro.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal),
        color = if (active) AppColors.ink else AppColors.muted,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .clip(Shape.control)
            .border(
                Hairline,
                if (active) AppColors.ink else AppColors.line,
                Shape.control,
            )
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/**
 * 通知条目 = 时间轴上的行，不是卡片。
 *
 * 改版前每条是圆角卡片 + 描边，一屏 8 条就是 8 个独立"盒子"，读起来像在刷商品列表。
 * 现在左侧一条细线串起当天的条目、条目之间用横线断开、未读用线上的圆点标记，
 * 同一条通知的视觉重量从"一个容器"降到"一行字"。
 */
@Composable
private fun NoticeRow(notice: Notice, isRead: Boolean, isFav: Boolean, onOpen: () -> Unit, onToggleFav: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            // 轴区：竖线通高，相邻条目首尾相接 → 整列连起来是一条连续的时间轴
            Box(Modifier.width(14.dp).fillMaxHeight()) {
                Box(Modifier.align(Alignment.Center).fillMaxHeight().width(1.dp).background(AppColors.line))
                // 未读 = 实心朱红；已读 = 底色填充 + 细描边的空心点（直接画空心圈会露出里面的竖线）
                val dot = Modifier.align(Alignment.TopCenter).padding(top = 10.dp).size(5.dp)
                if (isRead) {
                    Box(dot.background(AppColors.bg, CircleShape).border(Hairline, AppColors.muted, CircleShape))
                } else {
                    Box(dot.background(AppColors.accent, CircleShape))
                }
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onOpen() }
                    .padding(start = Space.s, end = Space.xs, top = 7.dp, bottom = 13.dp),
            ) {
                Text(
                    notice.sourceName,
                    style = Type.micro,
                    color = AppColors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    notice.title,
                    style = Type.body,
                    fontWeight = if (isRead) FontWeight.Normal else FontWeight.Medium,
                    color = if (isRead) AppColors.ink2 else AppColors.ink,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                notice.tag?.let { tag ->
                    Spacer(Modifier.height(7.dp))
                    TagLabel(tag)
                }
            }
            // 收藏用矢量星，不用 ★/☆ 字符：字符星在不同 ROM 里字重和基线都不一样
            IconButton(
                onClick = onToggleFav,
                modifier = Modifier.padding(top = 1.dp, end = 2.dp).size(32.dp),
            ) {
                Icon(
                    painter = painterResource(if (isFav) R.drawable.ic_star else R.drawable.ic_star_outline),
                    contentDescription = if (isFav) "取消收藏" else "收藏",
                    modifier = Modifier.size(16.dp),
                    tint = if (isFav) AppColors.accent else AppColors.muted,
                )
            }
        }
        // 行分隔线从内容起点缩进：缩进 14dp 就是轴区宽度，线不穿过时间轴
        Box(Modifier.padding(start = 14.dp).fillMaxWidth().height(Hairline).background(AppColors.line))
    }
}

/** 来源 tab：文字 + 计数 + 2dp 下划线，选中态只换字重和墨色，不铺底色。 */
@Composable
private fun NavTab(text: String, count: Int, active: Boolean, onClick: () -> Unit) {
    val underline = if (active) AppColors.ink else Color.Transparent
    // 下划线用 drawBehind 画，不用 fillMaxWidth 的 Box：横向滚动的 Row 给子项的宽度约束是无限，
    // fillMaxWidth 遇到无限约束会退化成 0 宽，下划线会静默消失（第一版就是这么没的）。
    Column(
        modifier = Modifier
            .clickable { onClick() }
            .padding(top = Space.s)
            .drawBehind {
                if (underline.alpha > 0f) {
                    val h = 2.dp.toPx()
                    drawRect(
                        color = underline,
                        topLeft = Offset(0f, size.height - h),
                        size = Size(size.width, h),
                    )
                }
            },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = text,
                style = Type.label.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal),
                color = if (active) AppColors.ink else AppColors.muted,
                maxLines = 1,
            )
            Spacer(Modifier.width(5.dp))
            Text("$count", style = Type.micro, color = AppColors.muted, maxLines = 1)
        }
        Spacer(Modifier.height(Space.s))
    }
}

/** "2026-10-20" → "10 月 20 日 · 周二"。解析失败就原样返回（"日期未知" 这类占位不会崩）。 */
private fun dayLabel(date: String): String = try {
    val day = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.CHINA).parse(date)
    if (day == null) date else java.text.SimpleDateFormat("M 月 d 日 · EEE", java.util.Locale.CHINA).format(day)
} catch (e: Exception) {
    date
}

/** 标签只描边不铺底色。改版前是 6 个高饱和色块铺满，一屏 8 张卡就有 8 块彩色。 */
@Composable
private fun TagLabel(tag: String) {
    val color = tagColor(tag)
    Text(
        text = tag,
        style = Type.micro.copy(fontWeight = FontWeight.Medium),
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .border(Hairline, color.copy(alpha = 0.5f), Shape.tag)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
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
        contentPadding = PaddingValues(horizontal = Space.page, vertical = Space.m),
        verticalArrangement = Arrangement.spacedBy(Space.group),
    ) {
        item {
            // 数字领读：六个关键数字 + 竖线分隔。报纸的数据版从不把数字装进彩色方块
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StatBox("${items.size}", "累计归档", Modifier.weight(1f))
                    VDivider()
                    StatBox("$recent7", "最近 7 天", Modifier.weight(1f))
                    VDivider()
                    StatBox("$recent30", "最近 30 天", Modifier.weight(1f))
                }
                Spacer(Modifier.height(Space.m))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StatBox("${perDay.size}", "有新增的天数", Modifier.weight(1f))
                    VDivider()
                    StatBox(busiest?.let { "${it.value}" } ?: "0", "单日最多", Modifier.weight(1f))
                    VDivider()
                    StatBox("${snapshot?.bySource?.size ?: 0}", "覆盖来源", Modifier.weight(1f))
                }
                val foot = buildString {
                    busiest?.let { append("单日最多是 ${dayLabel(it.key)}，${it.value} 条") }
                    snapshot?.generatedAt?.takeIf { it.isNotEmpty() }?.let {
                        if (isNotEmpty()) append("　·　")
                        append("数据生成于 ${it.replace("T", " ").take(16)}")
                    }
                }
                if (foot.isNotEmpty()) {
                    Spacer(Modifier.height(Space.s))
                    Text(foot, style = Type.micro, color = AppColors.muted)
                }
            }
        }
        item {
            SectionTitle("最近 14 天发现量", "朱红为今天")
            BarRow(
                labels = trend.map { it.first.takeLast(2) },
                values = trend.map { it.second },
                highlightIndex = trend.lastIndex,
            )
        }
        item {
            SectionTitle("按来源", "${snapshot?.bySource?.size ?: 0} 个")
            BarList(snapshot?.bySource?.map { it.sourceName to it.count } ?: emptyList())
        }
        item {
            SectionTitle("按标签", "${tags.size} 类")
            BarList(tags.map { it.first to it.second }, tagColored = true)
        }
        item {
            val names = listOf("日", "一", "二", "三", "四", "五", "六")
            // 今天落在星期轴的哪一格：与 weekdays 的 Calendar.DAY_OF_WEEK - 1 同一套下标
            val todayIdx = remember { Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1 }
            SectionTitle("星期分布", "今天是周${names[todayIdx]}")
            BarRow(labels = names, values = weekdays, highlightIndex = todayIdx)
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

/** 栏目名 + 通栏细线：统计页的骨架，比卡片更像"报刊的一个版块"。 */
@Composable
private fun SectionTitle(title: String, note: String? = null) {
    Column(Modifier.fillMaxWidth().padding(bottom = Space.m)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Type.label, fontWeight = FontWeight.SemiBold, color = AppColors.ink)
            Spacer(Modifier.weight(1f))
            if (note != null) Text(note, style = Type.micro, color = AppColors.muted, maxLines = 1)
        }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
    }
}

/** 数字之间的竖线：代替色块分隔 */
@Composable
private fun VDivider() {
    Box(Modifier.padding(horizontal = Space.m).width(Hairline).height(32.dp).background(AppColors.line))
}

@Composable
private fun StatBox(value: String, label: String, modifier: Modifier = Modifier) {
    // 数字给到 display 级、说明压到 micro：读统计页时最先要的是数字本身
    Column(modifier = modifier) {
        Text(
            value,
            style = Type.display,
            color = AppColors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(label, style = Type.micro, color = AppColors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun BarRow(labels: List<String>, values: List<Int>, highlightIndex: Int? = null) {
    val max = (values.maxOrNull() ?: 1).coerceAtLeast(1)
    Column {
        Row(
            modifier = Modifier.fillMaxWidth().height(64.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            labels.forEachIndexed { i, _ ->
                val v = values.getOrElse(i) { 0 }
                val mark = highlightIndex == i
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height((64f * v / max).coerceAtLeast(if (v > 0) 2f else 0f).dp)
                        // 直角、墨色：圆角柱状图是"仪表盘"，直角柱状图是"统计表"
                        .background(if (mark) AppColors.accent else AppColors.ink2.copy(alpha = 0.7f)),
                )
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(AppColors.line))
        Spacer(Modifier.height(5.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            labels.forEachIndexed { i, label ->
                Text(
                    label,
                    style = Type.micro,
                    color = if (highlightIndex == i) AppColors.accent else AppColors.muted,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun BarList(rows: List<Pair<String, Int>>, tagColored: Boolean = false) {
    if (rows.isEmpty()) {
        Text("还没有数据", style = Type.micro, color = AppColors.muted)
        return
    }
    val max = (rows.maxOfOrNull { it.second } ?: 1).coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        rows.forEach { (name, count) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    style = Type.micro,
                    color = AppColors.ink2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.width(92.dp),
                )
                Spacer(Modifier.width(Space.s))
                // 底槽压到极淡：它是参照刻度，不是进度条的"未完成部分"
                Box(
                    modifier = Modifier.weight(1f).height(3.dp).background(AppColors.line.copy(alpha = 0.45f)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(count.toFloat() / max)
                            .height(3.dp)
                            .background(if (tagColored) tagColor(name) else AppColors.ink2.copy(alpha = 0.75f)),
                    )
                }
                Spacer(Modifier.width(Space.s))
                Text(
                    "$count",
                    style = Type.micro,
                    color = AppColors.muted,
                    textAlign = TextAlign.End,
                    modifier = Modifier.width(34.dp),
                )
            }
        }
    }
}

// ---------------------------------------------------------------- 设置

/** 用系统浏览器打开链接（应用内不做 WebView，避免额外的权限与风险） */
private fun openUrl(context: android.content.Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}

/**
 * 设置页的一"节"：栏目名（小字、拉开字距）+ 通栏细线 + 内容。
 * 不加卡片外框 —— 设置页是"书的目录页"，四块浮起的白卡是最典型的模板味。
 */
@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            title,
            style = Type.micro.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.06.em),
            color = AppColors.muted,
        )
        Spacer(Modifier.height(6.dp))
        Box(Modifier.fillMaxWidth().height(Hairline).background(AppColors.line))
        Spacer(Modifier.height(Space.s))
        content()
    }
}

/** 主操作：细墨框 + 墨字。实心色块留给"整个界面只能有一个"的动作。 */
@Composable
private fun ActionButton(
    text: String,
    enabled: Boolean = true,
    primary: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        text,
        style = Type.label.copy(fontWeight = if (primary) FontWeight.SemiBold else FontWeight.Normal),
        color = if (!enabled) AppColors.muted else if (primary) AppColors.ink else AppColors.ink2,
        modifier = Modifier
            .clip(Shape.control)
            .border(Hairline, if (primary) AppColors.ink else AppColors.line, Shape.control)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp, vertical = 7.dp),
    )
}

/** 次操作：文字 + 下划线。纸上的链接就是这样，没有按钮壳。
 *  注意：这里不能用 Box(fillMaxWidth) 画下划线 —— 在 Row 里它会吃掉全部剩余宽度，
 *  把后面的兄弟挤到屏幕外（真机上"清除收藏"整个消失）。用 TextDecoration 最稳。 */
@Composable
private fun TextLink(text: String, onClick: () -> Unit) {
    Text(
        text,
        style = Type.label,
        color = AppColors.ink2,
        textDecoration = TextDecoration.Underline,
        modifier = Modifier
            .clip(Shape.control)
            .clickable { onClick() }
            .padding(vertical = 7.dp, horizontal = 2.dp),
    )
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

/** 学校目录里的一行：左墨线标记选中，校名 + 层次 + 省市 + 已接入/待接入。 */
@Composable
private fun SchoolOptionRow(school: SchoolInfo, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) AppColors.sunken else Color.Transparent)
            .clickable { onClick() }
            .padding(horizontal = 6.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 选中用朱红竖线，不用整块圆角底 —— 目录里"点了哪个"应该像划了一道记号
        Box(Modifier.width(2.dp).height(30.dp).background(if (selected) AppColors.accent else Color.Transparent))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    school.name,
                    style = Type.label.copy(fontWeight = FontWeight.SemiBold),
                    color = if (school.active) AppColors.ink else AppColors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // 官方标签（双一流 / 民办）—— 比"层次"更值得第一眼看到
                school.tag?.let { t ->
                    Spacer(Modifier.width(6.dp))
                    Text(
                        t,
                        style = Type.micro,
                        color = AppColors.ink2,
                        maxLines = 1,
                        modifier = Modifier
                            .clip(Shape.tag)
                            .border(Hairline, AppColors.line, Shape.tag)
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
                // 本科是默认预期，只有专科/成人这种"和你以为的不一样"才标出来
                if (school.level.isNotEmpty() && school.level != "本科") {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        school.level,
                        style = Type.micro,
                        color = AppColors.muted,
                        maxLines = 1,
                        modifier = Modifier
                            .clip(Shape.tag)
                            .border(Hairline, AppColors.line, Shape.tag)
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (school.where.isNotEmpty()) {
                    Text(school.where, style = Type.micro, color = AppColors.muted, maxLines = 1)
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    if (school.active) "已接入" + (if (school.total > 0) " · ${school.total} 条" else "") else "待接入",
                    style = Type.micro,
                    color = if (school.active) AppColors.ink2 else AppColors.muted,
                )
            }
        }
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
    // 点了"还没接入"的学校时，给一条"申请接入"的直达 issue（校名预填）
    var requestFor by remember { mutableStateOf<SchoolInfo?>(null) }
    val context = LocalContext.current

    // 学院面板优先跟着"待确认的学校"；没有待确认的就跟着当前学校（老用户也能补勾学院）
    val viewing = pending ?: schoolIndex?.firstOrNull { it.id == schoolId }

    SettingsSection("学校 / 学院") {
        // 展开选校面板时高度会突变上百 dp，animateContentSize 让它是"掀开"而不是"跳一下"
        Column(Modifier.animateContentSize(animationSpec = tween(180))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        // 没进设置选过也已经在用了（默认学校），别显示成"未选择"让人以为没生效
                        if (schoolName.isNotEmpty()) schoolName else "未选择学校",
                        style = Type.body,
                        color = AppColors.ink,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        when {
                            schoolId.isEmpty() && units.isEmpty() -> "默认学校 · 还没勾选学院"
                            schoolId.isEmpty() -> "默认学校 · 已选 ${units.size} 个学院"
                            units.isEmpty() -> "还没勾选学院 · 现在显示该校全部通知"
                            else -> "已选 ${units.size} 个学院 · 切换后只显示该校数据"
                        },
                        style = Type.micro,
                        color = AppColors.muted,
                    )
                }
                ActionButton(if (open) "收起" else "选择") {
                    open = !open
                    if (open) onNeedIndex()
                }
            }

            if (open) {
                Spacer(Modifier.height(Space.m))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("搜索学校：校名 / 省份 / 城市（如 成都、电子科技）", style = Type.label, color = AppColors.muted) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))

                val list = schoolIndex
                if (list == null) {
                    Text(
                        if (indexLoading) "正在取学校目录…" else "学校目录取不到（镜像/网络问题），稍后再试",
                        style = Type.label,
                        color = AppColors.muted,
                    )
                } else {
                    // 命中数要报给用户（名单有 3167 所），所以先取全量再截断显示
                    val matched = searchSchools(list, query, limit = Int.MAX_VALUE)
                    Text(
                        if (query.isBlank()) {
                            "全国共 ${list.size} 所高校（已接入 ${list.count { it.active }} 所）· 直接搜校名 / 省份 / 城市"
                        } else {
                            "匹配 ${matched.size} 所" + if (matched.size > 40) "（只显示前 40 所，继续输入可缩小范围）" else ""
                        },
                        style = Type.micro,
                        color = AppColors.muted,
                    )
                    val hit = matched.take(40)
                    if (hit.isEmpty()) {
                        Text(
                            "没找到匹配的学校。可试试校名、省份或城市（例如 成都、电子科技）",
                            style = Type.label,
                            color = AppColors.muted,
                        )
                    }
                    hit.forEach { s ->
                        SchoolOptionRow(
                            school = s,
                            selected = s.id == pending?.id,
                            onClick = {
                                if (s.active) {
                                    pending = s
                                    requestFor = null
                                    note = "已选「${s.name}」。勾选你关心的学院，然后点下面的「确认切换」。"
                                } else {
                                    // 待接入的必须说清楚为什么不能选，否则用户以为应用坏了
                                    pending = null
                                    requestFor = s
                                    note = "「${s.name}」还没有接入：需要有该校栏目的选择器配置才能抓取。"
                                }
                            },
                        )
                    }
                }

                viewing?.let { s ->
                    if (s.units.isNotEmpty()) {
                        Spacer(Modifier.height(Space.m))
                        Text(
                            "${s.name} · 学院 / 栏目",
                            style = Type.label.copy(fontWeight = FontWeight.SemiBold),
                            color = AppColors.ink,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text("默认全不选，勾选你关心的（可多选）", style = Type.micro, color = AppColors.muted)
                        Spacer(Modifier.height(8.dp))
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
                            TextLink("全选") { onUnitsChange(s.units.map { it.name }.toSet()) }
                            Spacer(Modifier.width(Space.m))
                            TextLink("全不选") { onUnitsChange(emptySet()) }
                        }
                    } else if (s.active) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "这所学校没有学院/栏目数据，选中后直接显示该校全部通知。",
                            style = Type.micro,
                            color = AppColors.muted,
                        )
                    }
                }

                note?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, style = Type.micro, color = AppColors.muted)
                }

                // 还没接入的学校：让需求一键变成 issue（校名已预填），别让用户干看着
                requestFor?.let { s ->
                    Spacer(Modifier.height(4.dp))
                    TextLink("申请接入这所学校") { openUrl(context, requestIssueUrl(s.name)) }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "接入方法见仓库 docs/add-your-school.md —— 大多数站点一段 YAML 就行",
                        style = Type.micro,
                        color = AppColors.muted,
                    )
                }

                val ready = pending
                if (ready != null && ready.active) {
                    Spacer(Modifier.height(Space.m))
                    ActionButton("确认切换到「${ready.name}」", primary = true) { asking = true }
                }
            }
        }
    }

    // 二次确认：切换会立刻换掉整个列表，不能点一下就当切了
    val target = pending
    if (asking && target != null) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text("切换到「${target.name}」？", style = Type.body, fontWeight = FontWeight.SemiBold, color = AppColors.ink) },
            text = {
                val unitText = if (units.isEmpty()) {
                    "（还没勾选学院，列表会提示你先勾选）"
                } else {
                    "（已选 ${units.size} 个学院：${units.joinToString("、")}）"
                }
                Text("将立即刷新为该学校的通知" + unitText, style = Type.label, color = AppColors.ink2)
            },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    onSwitchSchool(target)
                    pending = null
                    requestFor = null
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

    var remoteVersion by remember { mutableStateOf<String?>(null) }
    var versionHint by remember { mutableStateOf("还没检查过") }
    var busy by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Space.page, vertical = Space.m),
        verticalArrangement = Arrangement.spacedBy(Space.group),
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

        // 应用更新
        item {
            SettingsSection("应用更新") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("当前版本 v${store.appVersion()}", style = Type.body, color = AppColors.ink)
                        Spacer(Modifier.height(3.dp))
                        Text(versionHint, style = Type.micro, color = AppColors.muted)
                    }
                    ActionButton("检查更新", enabled = !busy) {
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
                    }
                }
                val remote = remoteVersion
                if (remote != null && compareVersions(remote, store.appVersion()) > 0) {
                    Spacer(Modifier.height(Space.m))
                    InAppUpdateRow(version = remote, apkUrl = store.apkUrl())
                }
            }
        }

        // 数据
        item {
            SettingsSection("通知数据") {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("${snapshot?.items?.size ?: 0}", style = Type.display, color = AppColors.ink)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "条 · 数据时间 ${snapshot?.generatedAt?.replace("T", " ")?.take(16) ?: "-"} UTC",
                        style = Type.micro,
                        color = AppColors.muted,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    if (schoolId.isNotEmpty()) {
                        "来源：$schoolName 的学校数据 · ${store.schoolSource().ifEmpty { "本机缓存" }}（打开应用不联网，联网时按镜像自动刷新）"
                    } else {
                        "来源：${store.dataSource}（打开应用不联网，联网时按镜像自动刷新）"
                    },
                    style = Type.micro,
                    color = AppColors.muted,
                )
                Spacer(Modifier.height(Space.m))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ActionButton("立即刷新", enabled = !busy, primary = true) { onRefreshData() }
                    Spacer(Modifier.width(Space.m))
                    TextLink("清除已读") { onClearRead() }
                    Spacer(Modifier.width(Space.m))
                    TextLink("清除收藏") { onClearFav() }
                }
            }
        }

        // 关于（注意：应用内不出现"安装到手机"的引导，那是给网页版访客看的）
        item {
            SettingsSection("关于") {
                Text(
                    "这是 Android 原生应用：界面与当前数据都打包在应用内，打开不需要联网，也不会跳浏览器。",
                    style = Type.label,
                    color = AppColors.ink2,
                    lineHeight = 20.sp,
                )
                Spacer(Modifier.height(Space.s))
                Text(
                    "数据由 notice-radar 定时抓取（只抓公开页面、不登录、不存个人信息），" +
                        "站点结构变更可能导致漏抓，请以学校官网原文为准。",
                    style = Type.micro,
                    color = AppColors.muted,
                    lineHeight = 18.sp,
                )
                Spacer(Modifier.height(Space.s))
                TextLink("打开项目主页") {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/$REPO_SLUG")))
                    }
                }
            }
        }
    }
}

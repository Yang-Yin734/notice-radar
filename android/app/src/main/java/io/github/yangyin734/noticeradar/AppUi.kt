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

    // 打开：先用内置/缓存（零网络），再静默尝试镜像
    LaunchedEffect(Unit) {
        val bundled = store.bundled()
        val cached = store.cached()
        snapshot = when {
            cached != null && bundled != null && cached.generatedAt > bundled.generatedAt -> cached
            cached != null && bundled == null -> cached
            else -> bundled
        }
        withContext(Dispatchers.IO) {
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
                        onRefresh = {
                            scope.launch {
                                refreshing = true
                                val fresh = withContext(Dispatchers.IO) { store.refresh() }
                                refreshing = false
                                if (fresh != null && fresh.first.generatedAt > (snapshot?.generatedAt ?: "")) {
                                    snapshot = fresh.first
                                    toast = "已更新 ${fresh.first.items.size} 条（${fresh.second}）"
                                } else {
                                    toast = if (fresh == null) "连不上数据源，继续用本机数据" else "已是最新"
                                }
                            }
                        },
                    )

                    when (tab) {
                        0, 1 -> NoticeList(
                            snapshot = snapshot,
                            query = query,
                            onQueryChange = { query = it },
                            sourceFilter = sourceFilter,
                            onSourceFilter = { sourceFilter = it },
                            favOnly = tab == 1,
                            read = read,
                            fav = fav,
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
                        2 -> StatsScreen(snapshot)
                        else -> SettingsScreen(
                            store = store,
                            snapshot = snapshot,
                            dark = dark,
                            onToggleTheme = { store.themeOverride = !dark },
                            onClearRead = { read = mutableSetOf(); store.saveRead(emptySet()) },
                            onClearFav = { fav = mutableSetOf(); store.saveFav(emptySet()) },
                            onRefreshData = {
                                scope.launch {
                                    refreshing = true
                                    val fresh = withContext(Dispatchers.IO) { store.refresh() }
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

@Composable
private fun AppHeader(title: String, subtitle: String, refreshing: Boolean, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.width(8.dp))
        Text(subtitle, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        TextButton(onClick = onRefresh, enabled = !refreshing) {
            Text(if (refreshing) "刷新中…" else "刷新", fontSize = 13.sp)
        }
    }
}

// ---------------------------------------------------------------- 通知列表

private sealed interface Row {
    data class Day(val date: String, val count: Int) : Row
    data class Item(val notice: Notice) : Row
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
    onOpen: (Notice) -> Unit,
    onToggleFav: (Notice) -> Unit,
) {
    val all = snapshot?.items ?: emptyList()
    val sources = snapshot?.bySource ?: emptyList()

    val filtered = remember(all, query, sourceFilter, favOnly, fav) {
        val q = query.trim().lowercase()
        all.filter { n ->
            (!favOnly || n.id in fav) &&
                (sourceFilter == null || n.sourceId == sourceFilter) &&
                (q.isEmpty() || (n.title + " " + (n.tag ?: "") + " " + n.sourceName).lowercase().contains(q))
        }
    }

    val rows = remember(filtered) {
        val out = mutableListOf<Row>()
        filtered.groupBy { it.date.ifEmpty { "日期未知" } }.forEach { (date, list) ->
            out += Row.Day(date, list.size)
            list.forEach { out += Row.Item(it) }
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
                    if (favOnly) "还没有收藏，点通知卡片右下角的 ☆" else "没有匹配的通知",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 14.sp,
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
                    is Row.Day -> item(key = "day-${row.date}") {
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
                    is Row.Item -> item(key = row.notice.id) {
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

@Composable
private fun SettingsScreen(
    store: Store,
    snapshot: Snapshot?,
    dark: Boolean,
    onToggleTheme: () -> Unit,
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

    LaunchedEffect(hasToken) { loadPush() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
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
                            "要在这里开关推送，需要一个 fine-grained 令牌：只授权本仓库、权限勾 Variables: Read and write。" +
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
                                        remote > store.appVersion() -> "发现新版本 v$remote"
                                        else -> "已是最新（检查时间 ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())}）"
                                    }
                                }
                            },
                        ) { Text("检查更新", fontSize = 13.sp) }
                    }
                    val remote = remoteVersion
                    if (remote != null && remote > store.appVersion()) {
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = {
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(store.apkUrl()))) }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("下载新版本 v$remote（可直接覆盖安装）", fontSize = 13.sp) }
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
                    Text("来源：${store.dataSource}（打开应用不联网，联网时按镜像自动刷新）", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

        // 外观
        item {
            SettingsCard(title = "外观") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (dark) "深色模式" else "浅色模式", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.height(2.dp))
                        Text("跟随系统深浅色，也可以在这里手动切换", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = dark, onCheckedChange = { onToggleTheme() })
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

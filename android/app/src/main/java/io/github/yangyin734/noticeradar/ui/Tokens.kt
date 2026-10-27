package io.github.yangyin734.noticeradar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 设计令牌：全应用唯一取色 / 取字 / 取距 / 取角的地方。
 *
 * 为什么要有这个文件：改版前 1363 行的 AppUi.kt 里散着 15 个半档字号（10/10.5/11/11.5…）、
 * 4 种圆角（14/20/10/5）、6 个高饱和标签色和一个 AI 默认蓝（#1C7ED6）。没有约束就会
 * 随手加减 0.5sp，视觉上必然糊成一片——那是"AI 味"的根源，不是配色问题。
 *
 * 定位 A「公告栏 / 教务处的纸」：暖白纸 + 墨黑字 + 单一朱红（印章色）。
 * 硬规则（改 UI 前先读）：
 *   1. 全应用只有 1 个强调色 accent；语义色只用于标签的文字与描边，不铺底色
 *   2. UI 里不出现 emoji（图标一律用 res/drawable/ic_*.xml）
 *   3. 字号只能取 Type 的 5 级，出现 10.5 / 11.5 / 12.5 / 13.5 / 14.5 一律打回
 *   4. 圆角只有 Shape.card / Shape.control / Shape.tag 三个值
 *   5. 卡片一律 elevation 0 + 0.5dp 描边，不允许阴影
 *   6. 不允许渐变（唯一例外：统计图峰值柱）
 */

// ---------------------------------------------------------------- 颜色

/** 浅色：暖白纸 + 墨黑 + 朱红 */
object Paper {
    val background = Color(0xFFFBFAF7)
    val surface = Color(0xFFFFFFFF)
    /** 比页面略沉一档的底：提示条、统计数字块。必须与 background 有差，否则这些块等于没底 */
    val sunken = Color(0xFFF2EDE5)
    val ink = Color(0xFF1A1A1A)
    val ink2 = Color(0xFF3F3F3F)
    /** 说明 / 时间 / 计数：对比度 5.2:1，11sp 仍可读 */
    val muted = Color(0xFF6E6A63)
    val line = Color(0xFFE7E2D8)
    val accent = Color(0xFFB23A2E)
    val accentSoft = Color(0xFFF6E7E3)
    /** 标签语义色：饱和度压到 ≤55%，只用于文字与描边 */
    val tagExam = Color(0xFFA63D2F)
    val tagTeach = Color(0xFF2F5D7C)
    val tagStudent = Color(0xFF3F6B4A)
    val tagPractice = Color(0xFF5E5680)
    val tagAcademic = Color(0xFF2F6F6B)
    val tagOther = Color(0xFF6E6A63)
}

/** 深色：暖黑，不是蓝黑（#12161F 那种蓝黑一眼"科技模板"） */
object Night {
    val background = Color(0xFF151311)
    val surface = Color(0xFF1D1A17)
    /** 比页面抬一档：深色下"沉下去"的块会看不见，所以这里反而更亮 */
    val sunken = Color(0xFF231F1B)
    val ink = Color(0xFFEDE9E2)
    val ink2 = Color(0xFFC9C4BA)
    val muted = Color(0xFF9A948A)
    val line = Color(0xFF2C2822)
    val accent = Color(0xFFD9614F)
    val accentSoft = Color(0xFF33231F)
    val tagExam = Color(0xFFD97A6B)
    val tagTeach = Color(0xFF7BA7C4)
    val tagStudent = Color(0xFF7FB08C)
    val tagPractice = Color(0xFF9C93BE)
    val tagAcademic = Color(0xFF6FB3AE)
    val tagOther = Color(0xFF9A948A)
}

/** 当前主题的纸色 / 墨色 / 线色 / 强调色。比 MaterialTheme.colorScheme 少一层间接，读代码更直白。 */
object AppColors {
    val bg: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.background

    /** 卡片、输入框、导航栏 */
    val paper: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surface

    /** 次要底色：分组头、chip 未选中 */
    val sunken: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceVariant

    val ink: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onBackground

    val ink2: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onSurface

    /** 说明 / 时间 / 计数 */
    val muted: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onSurfaceVariant

    /** 0.5dp 描边与分隔线，阴影的替代品 */
    val line: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.outline

    val accent: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primary

    val accentSoft: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primaryContainer

    val onAccent: Color
        @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onPrimary
}

internal val LightScheme = lightColorScheme(
    primary = Paper.accent,
    onPrimary = Color.White,
    primaryContainer = Paper.accentSoft,
    onPrimaryContainer = Paper.accent,
    background = Paper.background,
    onBackground = Paper.ink,
    surface = Paper.surface,
    onSurface = Paper.ink2,
    surfaceVariant = Paper.sunken,
    onSurfaceVariant = Paper.muted,
    outline = Paper.line,
    outlineVariant = Paper.line,
    // 明确写死：不跟随动态取色，否则 Android 12+ 会用壁纸色把朱红覆盖掉
    secondary = Paper.ink2,
    onSecondary = Color.White,
)

internal val DarkScheme = darkColorScheme(
    primary = Night.accent,
    onPrimary = Color(0xFF1A0E0B),
    primaryContainer = Night.accentSoft,
    onPrimaryContainer = Night.accent,
    background = Night.background,
    onBackground = Night.ink,
    surface = Night.surface,
    onSurface = Night.ink2,
    surfaceVariant = Night.sunken,
    onSurfaceVariant = Night.muted,
    outline = Night.line,
    outlineVariant = Night.line,
    secondary = Night.ink2,
    onSecondary = Color(0xFF1A0E0B),
)

// ---------------------------------------------------------------- 字阶（只有 5 级 + 1 个数字变体）

/**
 * 中文行高不低于 1.45×字号；数字一律 tabular（等宽），纵向才比得出来。
 * 改版前的最小字号是 10.5sp，中文在这个尺寸下笔画会糊 —— 下限提到 11sp。
 */
object Type {
    /** 页面大数字、统计首位 */
    val display = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold)

    /** 页面标题、通知标题 */
    val title = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)

    /** 通知正文、设置行 */
    val body = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)

    /** 按钮、tab、行标题 */
    val label = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)

    /** 计数、时间、标签：全应用最小，不再往下 */
    val micro = TextStyle(fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
}

internal val AppTypography = Typography(
    displaySmall = Type.display,
    titleLarge = Type.title,
    bodyLarge = Type.body,
    labelLarge = Type.label,
    labelSmall = Type.micro,
)

// ---------------------------------------------------------------- 间距 / 圆角

object Space {
    val xs = 4.dp
    val s = 8.dp
    val m = 12.dp
    /** 页面左右边距 */
    val page = 16.dp
    /** 卡片内边距 / 列表项内边距 */
    val item = 14.dp
    /** 卡片之间的间距 */
    val gap = 10.dp
    /** 分组之间 */
    val group = 24.dp
}

object Shape {
    /** 卡片、输入框、底部抽屉 */
    val card = androidx.compose.foundation.shape.RoundedCornerShape(10.dp)

    /** 按钮、chip、图标按钮 */
    val control = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)

    /** 标签 */
    val tag = androidx.compose.foundation.shape.RoundedCornerShape(3.dp)
}

/** 描边宽度：阴影的替代品，永远 0.5dp */
val Hairline = 0.5.dp

// ---------------------------------------------------------------- 深浅色判断

/**
 * 当前是否深色。
 *
 * 不用 isSystemInDarkTheme()：用户可以在设置里强制深色，这时系统仍然报浅色，会拿到错的答案。
 * 也不用 CompositionLocal：MaterialTheme 只有一层，忘了在外面 provides 就永远取到默认的 false，
 * 而且这种错是静默的——深色下标签色不会崩，只会悄悄继续用浅色版。
 * 直接看当前主题背景的亮度最稳：谁定的背景，就由谁判深浅。
 */
@Composable
@ReadOnlyComposable
private fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f

// ---------------------------------------------------------------- 标签色

/** 标签 → 语义色。只用于文字与描边，不铺底色（改版前是 6 个纯色色块铺满）。 */
@Composable
@ReadOnlyComposable
fun tagColor(tag: String?): Color {
    val dark = isDarkTheme()
    return when {
        tag == null -> if (dark) Night.tagOther else Paper.tagOther
        tag.contains("考试") || tag.contains("补考") || tag.contains("缓考") ->
            if (dark) Night.tagExam else Paper.tagExam
        tag.contains("教管") || tag.contains("教学") -> if (dark) Night.tagTeach else Paper.tagTeach
        tag.contains("学生事务") -> if (dark) Night.tagStudent else Paper.tagStudent
        tag.contains("实践") -> if (dark) Night.tagPractice else Paper.tagPractice
        tag.contains("学术") || tag.contains("讲座") -> if (dark) Night.tagAcademic else Paper.tagAcademic
        else -> if (dark) Night.tagOther else Paper.tagOther
    }
}
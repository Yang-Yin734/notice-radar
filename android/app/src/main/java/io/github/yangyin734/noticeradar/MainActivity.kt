package io.github.yangyin734.noticeradar

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

/**
 * 纯原生（Kotlin + Compose）入口。
 *
 * 和之前 WebView 版本的区别：
 *   - 界面是原生 Compose 组件，不再是网页
 *   - enableEdgeToEdge() + Scaffold/NavigationBar 处理系统栏内边距，
 *     加上 themes.xml 里把窗口底色设成应用底色 —— 不会再有底部白条
 *   - 应用内不出现"安装到手机"的引导（那只对网页版访客有意义）
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val store = Store(applicationContext)
        setContent { NoticeRadarApp(store) }
    }
}

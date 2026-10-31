package io.github.yangyin734.noticeradar

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * 后台提醒：WorkManager 定期拉一次数据，发现"没读过、也没提醒过"的条目就弹一条系统通知。
 *
 * 三条底线（这个应用的性格就是"别吵"）：
 *   1. 一次刷新只发一条汇总通知，不是一条通知一个弹窗；
 *   2. 读过的不再提醒，提醒过的不再提醒（两套集合分开记）；
 *   3. 默认关闭，关掉就 cancelUniqueWork，不留在后台偷偷跑。
 */
object NoticeNotify {
    const val CHANNEL_ID = "new-notice"
    private const val UNIQUE_WORK = "notice-radar-poll"
    private const val NOTIFY_ID = 3401

    /** SharedPreferences 里最多留多少个已通知 id，防止无限增长 */
    const val MAX_IDS = 600

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "新通知", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "学校官网出了新通知时提醒一次"
            },
        )
    }

    /** Android 13+ 没授权就发不出去，调用方要先请求权限 */
    fun canPost(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) true
        else ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun schedule(ctx: Context, enabled: Boolean) {
        val wm = WorkManager.getInstance(ctx)
        if (!enabled) {
            wm.cancelUniqueWork(UNIQUE_WORK)
            return
        }
        ensureChannel(ctx)
        // 30 分钟是"够快"与"别烧电"的折中；系统仍可能因省电策略把它往后挪，所以文案里不承诺准时
        val request = PeriodicWorkRequestBuilder<NoticeWorker>(30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        wm.enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * 发一条汇总通知。挑最靠前的三条列出来，其余只在标题里计数——正文里塞不下也不该塞。
     */
    internal fun post(ctx: Context, picks: List<Notice>, total: Int) {
        if (picks.isEmpty() || !canPost(ctx)) return
        ensureChannel(ctx)

        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val pending = PendingIntent.getActivity(ctx, NOTIFY_ID, intent, flags)

        val title = if (total == 1) "有 1 条新通知" else "有 $total 条新通知"
        val lines = picks.take(3).map { "· ${it.sourceName}：${it.title}" }
        val clip = if (total > picks.take(3).size) "\n（另有 ${total - picks.take(3).size} 条，打开查看）" else ""

        val built = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notice)
            .setContentTitle(title)
            .setContentText(picks.first().title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(lines.joinToString("\n") + clip))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIFY_ID, built) }
    }
}

class NoticeWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        if (!store.notifyEnabled) return Result.success()

        // 拉数据这一步是阻塞 IO（HttpURLConnection），挪到 IO 线程
        val snapshot = withContext(Dispatchers.IO) { store.refresh()?.first } ?: return Result.retry()

        val notified = store.notifiedIds()
        val read = store.readIds()
        val fresh = snapshot.items.filter { it.id !in notified && it.id !in read }

        // 只取最新的几条做汇总；剩下的靠记账静默带过，避免第一次开启时几十条糊一脸
        val picks = fresh.sortedByDescending { it.date }.take(3)
        if (picks.isNotEmpty()) NoticeNotify.post(applicationContext, picks, fresh.size)

        // 记账：把本次看到的全部 id 并入已通知集合，只留最近 600 个
        val merged = (notified + snapshot.items.map { it.id }).toList()
            .takeLast(NoticeNotify.MAX_IDS)
            .toSet()
        store.saveNotified(merged)
        return Result.success()
    }
}
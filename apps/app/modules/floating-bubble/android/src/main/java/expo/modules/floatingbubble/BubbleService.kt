package expo.modules.floatingbubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import kotlin.math.abs

/**
 * Shows a small draggable "+" button over other apps. Tapping it opens the app's Capture screen
 * (learninglog://capture). Runs as a foreground service so Android keeps it alive, and shows a
 * normal notification so the user always knows it is on.
 */
class BubbleService : Service() {
  companion object {
    @Volatile
    var running = false

    private const val CHANNEL_ID = "quick_capture_bubble"
    private const val NOTIFICATION_ID = 4201
  }

  private var windowManager: WindowManager? = null
  private var bubble: View? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    addBubble()
    running = true
  }

  override fun onDestroy() {
    running = false
    bubble?.let { runCatching { windowManager?.removeView(it) } }
    bubble = null
    super.onDestroy()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun buildNotification(): Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Quick capture button", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("learninglog://capture"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder
      .setContentTitle("Learning Log quick capture is on")
      .setContentText("Tap to capture a note. Turn it off in Learning Log > Settings.")
      .setSmallIcon(applicationInfo.icon)
      .setContentIntent(pending)
      .setOngoing(true)
      .build()
  }

  private fun addBubble() {
    val wm = getSystemService(WINDOW_SERVICE) as WindowManager
    windowManager = wm
    val size = dp(56)

    val view = TextView(this).apply {
      text = "+"
      textSize = 28f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      contentDescription = "Capture a note"
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#4F46E5"))
      }
      elevation = dp(6).toFloat()
    }

    val params = WindowManager.LayoutParams(
      size,
      size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = resources.displayMetrics.widthPixels - size - dp(8)
      y = resources.displayMetrics.heightPixels / 3
    }

    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    view.setOnTouchListener { v, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          touchX = event.rawX
          touchY = event.rawY
          moved = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchX).toInt()
          val dy = (event.rawY - touchY).toInt()
          if (abs(dx) > dp(6) || abs(dy) > dp(6)) moved = true
          if (moved) {
            params.x = startX + dx
            params.y = startY + dy
            wm.updateViewLayout(v, params)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (moved) {
            // Snap to the nearest screen edge.
            val screenWidth = resources.displayMetrics.widthPixels
            params.x = if (params.x + size / 2 < screenWidth / 2) dp(8) else screenWidth - size - dp(8)
            wm.updateViewLayout(v, params)
          } else {
            openCapture()
          }
          true
        }
        else -> false
      }
    }

    wm.addView(view, params)
    bubble = view
  }

  private fun openCapture() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("learninglog://capture"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    startActivity(intent)
  }
}

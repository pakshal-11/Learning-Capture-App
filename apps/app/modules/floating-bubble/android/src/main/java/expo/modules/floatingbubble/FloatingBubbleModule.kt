package expo.modules.floatingbubble

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FloatingBubbleModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FloatingBubble")

    Function("canDrawOverlays") {
      Settings.canDrawOverlays(context)
    }

    Function("isRunning") {
      BubbleService.running
    }

    // Opens Android's "Display over other apps" screen for this app. The user flips the switch themselves.
    Function("openOverlaySettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // Returns false (and does nothing) until the overlay permission has been granted.
    Function("start") {
      if (Settings.canDrawOverlays(context)) {
        ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java))
        true
      } else {
        false
      }
    }

    Function("stop") {
      context.stopService(Intent(context, BubbleService::class.java))
    }
  }
}

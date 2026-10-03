package cloud.agentdevice.node

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class CapturedScreen(
    val data: ByteArray,
    val width: Int,
    val height: Int,
    val sha256: String
)

object ScreenCaptureSession {
    private val lock = Any()

    @Volatile
    private var projection: MediaProjection? = null
    private var reader: ImageReader? = null
    private var display: VirtualDisplay? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null
    private var captureWidth = 0
    private var captureHeight = 0

    fun isActive(): Boolean = projection != null && reader != null && display != null

    fun start(context: Context, resultCode: Int, data: Intent) {
        require(resultCode == Activity.RESULT_OK) { "Screen capture consent was not granted" }
        synchronized(lock) {
            stopLocked()
            val manager = context.getSystemService(MediaProjectionManager::class.java)
            val nextProjection = manager.getMediaProjection(resultCode, data)
                ?: throw IllegalStateException("Android did not provide a screen capture session")
            val metrics = displayMetrics(context)
            val nextThread = HandlerThread("adc-screen-capture").apply { start() }
            val nextHandler = Handler(nextThread.looper)
            val nextReader = ImageReader.newInstance(
                metrics.widthPixels,
                metrics.heightPixels,
                PixelFormat.RGBA_8888,
                3
            )
            nextProjection.registerCallback(
                object : MediaProjection.Callback() {
                    override fun onStop() {
                        synchronized(lock) {
                            if (projection === nextProjection) stopLocked(stopProjection = false)
                        }
                        notifyCapabilityChanged(context)
                    }
                },
                nextHandler
            )
            val nextDisplay = nextProjection.createVirtualDisplay(
                "ADC screen capture",
                metrics.widthPixels,
                metrics.heightPixels,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                nextReader.surface,
                null,
                nextHandler
            )
            projection = nextProjection
            reader = nextReader
            display = nextDisplay
            handlerThread = nextThread
            handler = nextHandler
            captureWidth = metrics.widthPixels
            captureHeight = metrics.heightPixels
        }
        notifyCapabilityChanged(context)
    }

    fun stop(context: Context? = null) {
        synchronized(lock) {
            stopLocked()
        }
        context?.let(::notifyCapabilityChanged)
    }

    fun capture(maxWidth: Int, cancelled: () -> Boolean): CapturedScreen {
        synchronized(lock) {
            val currentReader = reader
                ?: throw CapabilityException(
                    "denied",
                    "Allow screen capture in ADC Mobile Node before requesting a screenshot.",
                    false
                )
            val currentHandler = handler
                ?: throw CapabilityException(
                    "offline",
                    "The Android screen capture session is unavailable.",
                    true
                )
            var image = currentReader.acquireLatestImage()
            if (image == null) {
                val ready = CountDownLatch(1)
                currentReader.setOnImageAvailableListener(
                    {
                        image = it.acquireLatestImage()
                        if (image != null) ready.countDown()
                    },
                    currentHandler
                )
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (!cancelled() && image == null && System.nanoTime() < deadline) {
                    ready.await(100, TimeUnit.MILLISECONDS)
                }
                currentReader.setOnImageAvailableListener(null, null)
            }
            if (cancelled()) {
                image?.close()
                throw CapabilityException("cancelled", "Invocation was cancelled.", false)
            }
            val captured = image
                ?: throw CapabilityException(
                    "offline",
                    "Android did not provide a screen frame.",
                    true
                )
            return try {
                encode(captured, captureWidth, captureHeight, maxWidth.coerceIn(320, 2160))
            } finally {
                captured.close()
            }
        }
    }

    private fun encode(image: Image, width: Int, height: Int, maxWidth: Int): CapturedScreen {
        val plane = image.planes.first()
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val paddedWidth = width + (rowStride - pixelStride * width) / pixelStride
        val padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(plane.buffer)
        val cropped = Bitmap.createBitmap(padded, 0, 0, width, height)
        if (cropped !== padded) padded.recycle()
        val output =
            if (width > maxWidth) {
                val scaledHeight = (height.toLong() * maxWidth / width).toInt().coerceAtLeast(1)
                Bitmap.createScaledBitmap(cropped, maxWidth, scaledHeight, true).also {
                    if (it !== cropped) cropped.recycle()
                }
            } else {
                cropped
            }
        val stream = ByteArrayOutputStream()
        try {
            if (!output.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                throw CapabilityException(
                    "execution_failed",
                    "Android could not encode the captured screen.",
                    true
                )
            }
            val bytes = stream.toByteArray()
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(bytes)
                .joinToString("") { "%02x".format(it) }
            return CapturedScreen(
                data = bytes,
                width = output.width,
                height = output.height,
                sha256 = "sha256:$digest"
            )
        } finally {
            output.recycle()
            stream.close()
        }
    }

    private fun stopLocked(stopProjection: Boolean = true) {
        val currentProjection = projection
        projection = null
        display?.release()
        display = null
        reader?.close()
        reader = null
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
        captureWidth = 0
        captureHeight = 0
        if (stopProjection) currentProjection?.stop()
    }

    private fun displayMetrics(context: Context): DisplayMetrics {
        val windowManager = context.getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) {
            val bounds = windowManager.maximumWindowMetrics.bounds
            return DisplayMetrics().apply {
                widthPixels = bounds.width()
                heightPixels = bounds.height()
                densityDpi = context.resources.displayMetrics.densityDpi
            }
        }
        @Suppress("DEPRECATION")
        return DisplayMetrics().also(windowManager.defaultDisplay::getRealMetrics)
    }

    private fun notifyCapabilityChanged(context: Context) {
        context.sendBroadcast(
            Intent(ACTION_CAPABILITY_CHANGED).setPackage(context.packageName)
        )
    }

    const val ACTION_CAPABILITY_CHANGED =
        "cloud.agentdevice.node.SCREEN_CAPTURE_CAPABILITY_CHANGED"
}

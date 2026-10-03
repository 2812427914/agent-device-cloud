package cloud.agentdevice.node

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

class NodeService : Service() {
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private val leaseExecutor = Executors.newSingleThreadScheduledExecutor()
    private lateinit var store: NodeStore
    private lateinit var protocol: NodeProtocol
    private lateinit var registry: CapabilityRegistry
    private lateinit var execution: MobileExecutionEngine

    override fun onCreate() {
        super.onCreate()
        store = NodeStore(this)
        protocol = NodeProtocol(store)
        registry = CapabilityRegistry(this)
        execution = MobileExecutionEngine(store, registry)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopNode()
                return START_NOT_STICKY
            }
            ACTION_SCREEN_CAPTURE_GRANTED -> {
                startForegroundNotification(screenCapture = true)
                val resultCode = intent.getIntExtra(EXTRA_SCREEN_CAPTURE_RESULT_CODE, 0)
                try {
                    val captureData =
                        intent.getParcelableExtra<Intent>(EXTRA_SCREEN_CAPTURE_DATA)
                            ?: throw IllegalArgumentException(
                                "Android did not return screen capture consent data."
                            )
                    ScreenCaptureSession.start(this, resultCode, captureData)
                } catch (error: Exception) {
                    store.setCapabilityEnabled(CapabilityGroup.SCREEN_CAPTURE, false)
                    sendBroadcast(
                        Intent(ScreenCaptureSession.ACTION_CAPABILITY_CHANGED)
                            .setPackage(packageName)
                            .putExtra(EXTRA_ERROR, error.message)
                    )
                    startForegroundNotification(screenCapture = false)
                }
                startPollingIfNeeded()
                return START_STICKY
            }
            ACTION_SCREEN_CAPTURE_STOP -> {
                ScreenCaptureSession.stop(this)
                startForegroundNotification(screenCapture = false)
                startPollingIfNeeded()
                return START_STICKY
            }
        }
        startForegroundNotification(screenCapture = ScreenCaptureSession.isActive())
        startPollingIfNeeded()
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        ScreenCaptureSession.stop()
        executor.shutdownNow()
        leaseExecutor.shutdownNow()
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        stopNode()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startPollingIfNeeded() {
        if (running.compareAndSet(false, true)) executor.execute(::pollLoop)
    }

    private fun pollLoop() {
        var backoffMs = 2_000L
        while (running.get()) {
            val config = store.config()
            if (config == null) {
                publishStatus(false, "Pair this phone before starting the Node.")
                stopSelf()
                return
            }
            try {
                val response = protocol.poll(config, registry.manifest(config.nodeId))
                val now = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
                store.setConnectionState(now, null)
                publishStatus(true, null)
                updateNotification("Connected · ${config.label}")
                backoffMs = 2_000L
                response.optJSONObject("dispatch")?.let { execute(config, it) }
                if (!sleep(if (response.isNull("dispatch")) POLL_INTERVAL_MS else 250L)) return
            } catch (error: Exception) {
                val message =
                    when (error) {
                        is NodeApiException -> "${error.code}: ${error.message}"
                        else -> error.message ?: error.javaClass.simpleName
                    }
                store.setConnectionState(null, message)
                publishStatus(false, message)
                updateNotification("Disconnected · retrying")
                if (error is NodeApiException && error.statusCode in listOf(401, 403)) {
                    stopSelf()
                    return
                }
                if (!sleep(backoffMs)) return
                backoffMs = min(backoffMs * 2, 60_000L)
            }
        }
    }

    private fun execute(config: NodeConfig, dispatch: JSONObject) {
        val dispatchId = dispatch.getString("dispatchId")
        val leaseToken = dispatch.getString("leaseToken")
        val acknowledged = protocol.acknowledge(config, dispatchId, leaseToken)
        val cancelled = AtomicBoolean(acknowledged.optBoolean("cancelRequested"))
        val leaseValid = AtomicBoolean(true)
        val leaseExpiresAt = AtomicLong(
            Instant.parse(acknowledged.getString("leaseExpiresAt")).toEpochMilli()
        )
        val isCancelled = {
            val expired = System.currentTimeMillis() >= leaseExpiresAt.get()
            if (expired) {
                leaseValid.set(false)
                cancelled.set(true)
            }
            cancelled.get() || !running.get()
        }
        val renewal = leaseExecutor.scheduleWithFixedDelay(
            {
                if (!isCancelled()) {
                    try {
                        val response = protocol.renewLease(config, dispatchId, leaseToken)
                        leaseExpiresAt.set(
                            Instant.parse(response.getString("leaseExpiresAt")).toEpochMilli()
                        )
                        if (response.optBoolean("cancelRequested")) cancelled.set(true)
                    } catch (error: Exception) {
                        if (
                            error is NodeApiException &&
                            error.statusCode in listOf(401, 403, 409)
                        ) {
                            leaseValid.set(false)
                            cancelled.set(true)
                        }
                    }
                }
            },
            LEASE_RENEW_INTERVAL_MS,
            LEASE_RENEW_INTERVAL_MS,
            TimeUnit.MILLISECONDS
        )
        try {
            val executionResult = execution.execute(config.nodeId, dispatch, isCancelled)
            if (leaseValid.get() && System.currentTimeMillis() < leaseExpiresAt.get()) {
                executionResult.artifacts.forEach {
                    protocol.uploadArtifact(config, dispatchId, it)
                }
                protocol.complete(config, dispatchId, leaseToken, executionResult.result)
            }
        } finally {
            renewal.cancel(true)
        }
    }

    private fun sleep(durationMs: Long): Boolean =
        try {
            Thread.sleep(durationMs)
            running.get()
        } catch (_: InterruptedException) {
            false
        }

    private fun stopNode() {
        running.set(false)
        ScreenCaptureSession.stop(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        publishStatus(false, "Node stopped")
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL,
                getString(R.string.node_service_channel),
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }

    private fun serviceNotification(text: String): android.app.Notification {
        val activity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, NodeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(getString(R.string.node_service_title))
            .setContentText(text)
            .setContentIntent(activity)
            .setOngoing(true)
            .addAction(0, "Stop", stop)
            .build()
    }

    private fun startForegroundNotification(screenCapture: Boolean) {
        val types =
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                (if (screenCapture) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                } else {
                    0
                })
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            serviceNotification(getString(R.string.node_service_idle)),
            types
        )
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, serviceNotification(text))
    }

    private fun publishStatus(connected: Boolean, error: String?) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_CONNECTED, connected)
                .putExtra(EXTRA_ERROR, error)
        )
    }

    companion object {
        const val ACTION_STATUS = "cloud.agentdevice.node.STATUS"
        const val EXTRA_CONNECTED = "connected"
        const val EXTRA_ERROR = "error"
        private const val ACTION_START = "cloud.agentdevice.node.START"
        private const val ACTION_STOP = "cloud.agentdevice.node.STOP"
        private const val ACTION_SCREEN_CAPTURE_GRANTED =
            "cloud.agentdevice.node.SCREEN_CAPTURE_GRANTED"
        private const val ACTION_SCREEN_CAPTURE_STOP =
            "cloud.agentdevice.node.SCREEN_CAPTURE_STOP"
        private const val EXTRA_SCREEN_CAPTURE_RESULT_CODE = "screenCaptureResultCode"
        private const val EXTRA_SCREEN_CAPTURE_DATA = "screenCaptureData"
        private const val SERVICE_CHANNEL = "adc-node-service"
        private const val NOTIFICATION_ID = 4101
        private const val POLL_INTERVAL_MS = 15_000L
        private const val LEASE_RENEW_INTERVAL_MS = 8_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, NodeService::class.java).setAction(ACTION_START)
            )
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, NodeService::class.java).setAction(ACTION_STOP)
            )
        }

        fun startScreenCapture(context: Context, resultCode: Int, data: Intent) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, NodeService::class.java)
                    .setAction(ACTION_SCREEN_CAPTURE_GRANTED)
                    .putExtra(EXTRA_SCREEN_CAPTURE_RESULT_CODE, resultCode)
                    .putExtra(EXTRA_SCREEN_CAPTURE_DATA, data)
            )
        }

        fun stopScreenCapture(context: Context) {
            context.startService(
                Intent(context, NodeService::class.java)
                    .setAction(ACTION_SCREEN_CAPTURE_STOP)
            )
        }
    }
}

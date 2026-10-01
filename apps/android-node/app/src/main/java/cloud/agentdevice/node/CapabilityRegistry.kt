package cloud.agentdevice.node

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object AppVisibility {
    private val foreground = AtomicBoolean(false)

    fun setForeground(value: Boolean) {
        foreground.set(value)
    }

    fun isForeground(): Boolean = foreground.get()
}

class CapabilityRegistry(
    private val context: Context
) {
    fun manifest(nodeId: String): JSONObject {
        val now = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        return JSONObject()
            .put("schemaVersion", "0.1")
            .put("nodeId", nodeId)
            .put(
                "tools",
                JSONArray()
                    .put(
                        descriptor(
                            "device.battery.get",
                            "Battery status",
                            "Read battery, charging and power-save state.",
                            "read",
                            available(now),
                            emptyObjectSchema(),
                            objectSchema("level", "charging", "powerSaveMode")
                        )
                    )
                    .put(
                        descriptor(
                            "device.network.get",
                            "Network status",
                            "Read active transport, validation and metering state.",
                            "read",
                            available(now),
                            emptyObjectSchema(),
                            objectSchema("connected", "transport", "metered")
                        )
                    )
                    .put(
                        descriptor(
                            "location.get",
                            "Current location",
                            "Read one location fix while this app is visible.",
                            "read",
                            locationAvailability(now),
                            JSONObject()
                                .put("type", "object")
                                .put(
                                    "properties",
                                    JSONObject()
                                        .put(
                                            "desiredAccuracy",
                                            JSONObject()
                                                .put("type", "string")
                                                .put(
                                                    "enum",
                                                    JSONArray()
                                                        .put("coarse")
                                                        .put("balanced")
                                                        .put("precise")
                                                )
                                                .put("default", "balanced")
                                        )
                                        .put(
                                            "maxAgeMs",
                                            JSONObject()
                                                .put("type", "integer")
                                                .put("minimum", 0)
                                                .put("maximum", 600_000)
                                                .put("default", 15_000)
                                        )
                                        .put(
                                            "timeoutMs",
                                            JSONObject()
                                                .put("type", "integer")
                                                .put("minimum", 1_000)
                                                .put("maximum", 30_000)
                                                .put("default", 10_000)
                                        )
                                )
                                .put("additionalProperties", false),
                            objectSchema("lat", "lon", "accuracyMeters", "timestamp", "source")
                        )
                    )
                    .put(
                        descriptor(
                            "notification.show",
                            "Show notification",
                            "Display a notification in the ADC Agent channel.",
                            "write",
                            notificationAvailability(now),
                            JSONObject()
                                .put("type", "object")
                                .put(
                                    "properties",
                                    JSONObject()
                                        .put(
                                            "title",
                                            JSONObject()
                                                .put("type", "string")
                                                .put("minLength", 1)
                                                .put("maxLength", 120)
                                        )
                                        .put(
                                            "body",
                                            JSONObject()
                                                .put("type", "string")
                                                .put("maxLength", 2000)
                                        )
                                )
                                .put("required", JSONArray().put("title").put("body"))
                                .put("additionalProperties", false),
                            objectSchema("shown")
                        )
                    )
            )
            .put("roots", JSONArray())
            .put("accessMode", "none")
            .put("platform", "android")
            .put("nodeVersion", "0.1.0")
            .put("advertisedAt", now)
    }

    fun execute(
        tool: String,
        args: JSONObject,
        cancelled: () -> Boolean = { false }
    ): JSONObject {
        if (cancelled()) {
            throw CapabilityException("cancelled", "Invocation was cancelled.", false)
        }
        return when (tool) {
            "device.battery.get" -> batteryStatus()
            "device.network.get" -> networkStatus()
            "location.get" -> currentLocation(args, cancelled)
            "notification.show" -> showNotification(args)
            else -> throw CapabilityException(
                "invalid_request",
                "Capability is not implemented by this mobile node.",
                false
            )
        }
    }

    private fun descriptor(
        name: String,
        title: String,
        description: String,
        risk: String,
        availability: JSONObject,
        inputSchema: JSONObject,
        outputSchema: JSONObject
    ): JSONObject =
        JSONObject()
            .put("name", name)
            .put("version", "0.1.0")
            .put("risk", risk)
            .put("sandboxProfiles", JSONArray().put("native-app"))
            .put("title", title)
            .put("description", description)
            .put("availability", availability)
            .put("inputSchema", inputSchema)
            .put("outputSchema", outputSchema)

    private fun available(now: String): JSONObject =
        JSONObject().put("state", "available").put("observedAt", now)

    private fun unavailable(state: String, reason: String, now: String): JSONObject =
        JSONObject()
            .put("state", state)
            .put("reason", reason)
            .put("observedAt", now)

    private fun locationAvailability(now: String): JSONObject {
        val coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        if (!coarse && !fine) {
            return unavailable(
                "permission_required",
                "Allow location access in Android settings.",
                now
            )
        }
        val manager = context.getSystemService(LocationManager::class.java)
        if (!locationEnabled(manager)) {
            return unavailable(
                "temporarily_unavailable",
                "Android location services are turned off.",
                now
            )
        }
        if (!AppVisibility.isForeground()) {
            return unavailable(
                "foreground_required",
                "Open ADC Mobile Node before requesting location.",
                now
            )
        }
        return available(now)
    }

    private fun notificationAvailability(now: String): JSONObject {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            return unavailable(
                "permission_required",
                "Allow notifications in Android settings.",
                now
            )
        }
        return available(now)
    }

    private fun batteryStatus(): JSONObject {
        val battery = context.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val power = context.getSystemService(android.os.PowerManager::class.java)
        return JSONObject()
            .put("level", if (level >= 0) level.toDouble() / scale.coerceAtLeast(1) else JSONObject.NULL)
            .put(
                "charging",
                status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL
            )
            .put("plugged", plugged != 0)
            .put("powerSaveMode", power.isPowerSaveMode)
            .put("observedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
    }

    private fun networkStatus(): JSONObject {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = manager.activeNetwork
        val capabilities = network?.let(manager::getNetworkCapabilities)
        val transport =
            when {
                capabilities == null -> "none"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
                else -> "other"
            }
        return JSONObject()
            .put("connected", capabilities != null)
            .put("transport", transport)
            .put("metered", manager.isActiveNetworkMetered)
            .put(
                "validated",
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
            )
            .put("observedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
    }

    private fun currentLocation(args: JSONObject, cancelled: () -> Boolean): JSONObject {
        if (!AppVisibility.isForeground()) {
            throw CapabilityException(
                "denied",
                "Location is available only while ADC Mobile Node is open.",
                false
            )
        }
        val coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        if (!coarse && !fine) {
            throw CapabilityException("denied", "Location permission is required.", false)
        }
        val desiredAccuracy = args.optString("desiredAccuracy", "balanced")
        if (desiredAccuracy == "precise" && !fine) {
            throw CapabilityException(
                "denied",
                "Precise location permission is required for this request.",
                false
            )
        }
        val manager = context.getSystemService(LocationManager::class.java)
        if (!locationEnabled(manager)) {
            throw CapabilityException("offline", "Android location services are off.", true)
        }
        val maxAgeMs = args.optLong("maxAgeMs", 15_000).coerceIn(0, 600_000)
        val timeoutMs = args.optLong("timeoutMs", 10_000).coerceIn(1_000, 30_000)
        val providers = enabledProviders(manager, desiredAccuracy, fine)
        val cached = providers
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (_: SecurityException) {
                    null
                }
            }
            .maxByOrNull(Location::getTime)
        val now = System.currentTimeMillis()
        val location =
            if (cached != null && now - cached.time <= maxAgeMs) cached
            else requestLocation(manager, providers.firstOrNull(), timeoutMs, cancelled)
                ?: throw CapabilityException("offline", "Location fix timed out.", true)
        if (cancelled()) {
            throw CapabilityException("cancelled", "Invocation was cancelled.", false)
        }
        return locationJson(location, desiredAccuracy == "precise")
    }

    private fun enabledProviders(
        manager: LocationManager,
        desiredAccuracy: String,
        fine: Boolean
    ): List<String> {
        val gps =
            LocationManager.GPS_PROVIDER.takeIf {
                fine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            }
        val network =
            LocationManager.NETWORK_PROVIDER.takeIf {
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            }
        val passive =
            LocationManager.PASSIVE_PROVIDER.takeIf {
                manager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)
            }
        return when (desiredAccuracy) {
            "precise" -> listOfNotNull(gps)
            "coarse" -> listOfNotNull(network, passive)
            else -> listOfNotNull(network, gps, passive)
        }
    }

    private fun locationEnabled(manager: LocationManager): Boolean =
        if (Build.VERSION.SDK_INT >= 28) {
            manager.isLocationEnabled
        } else {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }

    private fun requestLocation(
        manager: LocationManager,
        provider: String?,
        timeoutMs: Long,
        cancelled: () -> Boolean
    ): Location? {
        if (provider == null) return null
        val latch = CountDownLatch(1)
        var result: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                result = location
                latch.countDown()
            }

            @Deprecated("Deprecated in Android")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
        }
        val handler = Handler(Looper.getMainLooper())
        handler.post {
            try {
                @Suppress("DEPRECATION")
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            } catch (_: SecurityException) {
                latch.countDown()
            }
        }
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (!cancelled()) {
            val remaining = deadline - SystemClock.elapsedRealtime()
            if (remaining <= 0 || latch.await(minOf(remaining, 250), TimeUnit.MILLISECONDS)) break
        }
        handler.post { manager.removeUpdates(listener) }
        if (cancelled()) {
            throw CapabilityException("cancelled", "Invocation was cancelled.", false)
        }
        return result
    }

    private fun locationJson(location: Location, precise: Boolean): JSONObject =
        JSONObject()
            .put("lat", location.latitude)
            .put("lon", location.longitude)
            .put("accuracyMeters", location.accuracy.toDouble())
            .put("timestamp", DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(location.time)))
            .put("isPrecise", precise)
            .put("source", location.provider ?: "unknown")
            .apply {
                if (location.hasAltitude()) put("altitudeMeters", location.altitude)
                if (location.hasSpeed()) put("speedMps", location.speed.toDouble())
                if (location.hasBearing()) put("headingDeg", location.bearing.toDouble())
            }

    private fun showNotification(args: JSONObject): JSONObject {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            throw CapabilityException("denied", "Notification permission is required.", false)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                AGENT_CHANNEL,
                context.getString(R.string.agent_notifications_channel),
                NotificationManager.IMPORTANCE_DEFAULT
            )
        )
        val notification = NotificationCompat.Builder(context, AGENT_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(args.getString("title"))
            .setContentText(args.getString("body"))
            .setStyle(NotificationCompat.BigTextStyle().bigText(args.getString("body")))
            .setAutoCancel(true)
            .build()
        manager.notify((System.nanoTime() and 0x7fffffff).toInt(), notification)
        return JSONObject().put("shown", true)
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun emptyObjectSchema(): JSONObject =
        JSONObject().put("type", "object").put("additionalProperties", false)

    private fun objectSchema(vararg fields: String): JSONObject =
        JSONObject()
            .put("type", "object")
            .put(
                "properties",
                JSONObject().apply {
                    fields.forEach { put(it, JSONObject()) }
                }
            )

    companion object {
        private const val AGENT_CHANNEL = "adc-agent-notifications"
    }
}

class CapabilityException(
    val code: String,
    override val message: String,
    val retryable: Boolean
) : Exception(message)

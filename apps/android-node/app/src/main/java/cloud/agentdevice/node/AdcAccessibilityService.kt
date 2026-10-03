package cloud.agentdevice.node

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AdcAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        active = this
        notifyCapabilityChanged()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (active === this) active = null
        notifyCapabilityChanged()
        super.onDestroy()
    }

    private fun inspect(maxDepth: Int, maxNodes: Int): JSONObject {
        val root = rootInActiveWindow
            ?: throw CapabilityException(
                "offline",
                "Android did not expose an active accessibility window.",
                true
            )
        val nodes = JSONArray()
        val packageName = root.packageName?.toString()
        val queue = ArrayDeque<QueuedNode>()
        queue.add(QueuedNode(root, 0, null))
        var truncated = false
        try {
            while (queue.isNotEmpty()) {
                if (nodes.length() >= maxNodes) {
                    truncated = true
                    break
                }
                val current = queue.removeFirst()
                val node = current.node
                val id = nodes.length()
                nodes.put(nodeJson(node, id, current.parentId, current.depth))
                if (current.depth < maxDepth) {
                    for (index in 0 until node.childCount) {
                        node.getChild(index)?.let {
                            queue.add(QueuedNode(it, current.depth + 1, id))
                        }
                    }
                } else if (node.childCount > 0) {
                    truncated = true
                }
                node.recycle()
            }
        } finally {
            while (queue.isNotEmpty()) queue.removeFirst().node.recycle()
        }
        return JSONObject()
            .put("packageName", packageName ?: JSONObject.NULL)
            .put("windowCount", windows.size)
            .put("nodes", nodes)
            .put("truncated", truncated)
    }

    private fun performAction(args: JSONObject): JSONObject {
        val selector = args.getJSONObject("selector")
        val requested = args.getString("action")
        val matched = findNode(selector)
            ?: throw CapabilityException("not_found", "No visible UI element matched.", false)
        try {
            val target =
                if (requested == "click" || requested == "long_click") {
                    clickableNode(matched, requested == "long_click")
                } else {
                    AccessibilityNodeInfo.obtain(matched)
                }
            try {
                val action =
                    when (requested) {
                        "click" -> AccessibilityNodeInfo.ACTION_CLICK
                        "long_click" -> AccessibilityNodeInfo.ACTION_LONG_CLICK
                        "focus" -> AccessibilityNodeInfo.ACTION_FOCUS
                        "scroll_forward" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                        "scroll_backward" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                        "set_text" -> AccessibilityNodeInfo.ACTION_SET_TEXT
                        else -> throw CapabilityException(
                            "invalid_request",
                            "Unsupported accessibility action.",
                            false
                        )
                    }
                val arguments =
                    if (requested == "set_text") {
                        Bundle().apply {
                            putCharSequence(
                                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                                args.getString("text")
                            )
                        }
                    } else {
                        null
                    }
                val performed =
                    onMainThread {
                        if (arguments == null) {
                            target.performAction(action)
                        } else {
                            target.performAction(action, arguments)
                        }
                    }
                if (!performed) {
                    throw CapabilityException(
                        "execution_failed",
                        "Android rejected the requested accessibility action.",
                        false
                    )
                }
                return JSONObject()
                    .put("performed", true)
                    .put("action", requested)
                    .put("matched", nodeSummary(matched))
            } finally {
                target.recycle()
            }
        } finally {
            matched.recycle()
        }
    }

    private fun performGesture(args: JSONObject): JSONObject {
        val metrics = resources.displayMetrics
        val type = args.getString("type")
        val path = Path()
        val durationMs =
            when (type) {
                "tap" -> {
                    val x = args.getInt("x")
                    val y = args.getInt("y")
                    requireCoordinates(x, y, metrics.widthPixels, metrics.heightPixels)
                    path.moveTo(x.toFloat(), y.toFloat())
                    80L
                }
                "swipe" -> {
                    val startX = args.getInt("startX")
                    val startY = args.getInt("startY")
                    val endX = args.getInt("endX")
                    val endY = args.getInt("endY")
                    requireCoordinates(startX, startY, metrics.widthPixels, metrics.heightPixels)
                    requireCoordinates(endX, endY, metrics.widthPixels, metrics.heightPixels)
                    path.moveTo(startX.toFloat(), startY.toFloat())
                    path.lineTo(endX.toFloat(), endY.toFloat())
                    args.optLong("durationMs", 300L).coerceIn(50L, 5_000L)
                }
                else -> throw CapabilityException(
                    "invalid_request",
                    "Unsupported gesture type.",
                    false
                )
            }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        val completed = CountDownLatch(1)
        var succeeded = false
        val accepted =
            onMainThread {
                dispatchGesture(
                    gesture,
                    object : GestureResultCallback() {
                        override fun onCompleted(gestureDescription: GestureDescription?) {
                            succeeded = true
                            completed.countDown()
                        }

                        override fun onCancelled(gestureDescription: GestureDescription?) {
                            completed.countDown()
                        }
                    },
                    null
                )
            }
        if (!accepted || !completed.await(durationMs + 2_000L, TimeUnit.MILLISECONDS) || !succeeded) {
            throw CapabilityException(
                "execution_failed",
                "Android did not complete the requested gesture.",
                true
            )
        }
        return JSONObject().put("performed", true).put("type", type)
    }

    private fun performNavigation(action: String): JSONObject {
        val globalAction =
            when (action) {
                "back" -> GLOBAL_ACTION_BACK
                "home" -> GLOBAL_ACTION_HOME
                "recents" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
                else -> throw CapabilityException(
                    "invalid_request",
                    "Unsupported navigation action.",
                    false
                )
            }
        if (!onMainThread { performGlobalAction(globalAction) }) {
            throw CapabilityException(
                "execution_failed",
                "Android rejected the requested navigation action.",
                false
            )
        }
        return JSONObject().put("performed", true).put("action", action)
    }

    private fun findNode(selector: JSONObject): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        val wantedIndex = selector.optInt("index", 0)
        var matchedIndex = 0
        try {
            while (queue.isNotEmpty()) {
                val node = queue.removeFirst()
                if (matches(node, selector)) {
                    if (matchedIndex == wantedIndex) {
                        while (queue.isNotEmpty()) queue.removeFirst().recycle()
                        return node
                    }
                    matchedIndex += 1
                }
                for (index in 0 until node.childCount) {
                    node.getChild(index)?.let(queue::add)
                }
                node.recycle()
            }
        } finally {
            while (queue.isNotEmpty()) queue.removeFirst().recycle()
        }
        return null
    }

    private fun matches(node: AccessibilityNodeInfo, selector: JSONObject): Boolean {
        val contains = selector.optString("match", "exact") == "contains"
        fun field(name: String, actual: CharSequence?): Boolean {
            if (!selector.has(name)) return true
            val expected = selector.optString(name)
            val value = actual?.toString() ?: return false
            return if (contains) value.contains(expected, ignoreCase = true) else value == expected
        }
        return field("resourceId", node.viewIdResourceName) &&
            field("text", if (node.isPassword) null else node.text) &&
            field("contentDescription", node.contentDescription) &&
            field("className", node.className) &&
            field("packageName", node.packageName)
    }

    private fun clickableNode(
        source: AccessibilityNodeInfo,
        longClick: Boolean
    ): AccessibilityNodeInfo {
        var current = AccessibilityNodeInfo.obtain(source)
        repeat(12) {
            if (if (longClick) current.isLongClickable else current.isClickable) return current
            val parent = current.parent ?: return current
            current.recycle()
            current = parent
        }
        return current
    }

    private fun nodeJson(
        node: AccessibilityNodeInfo,
        id: Int,
        parentId: Int?,
        depth: Int
    ): JSONObject {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        return JSONObject()
            .put("id", id)
            .put("parentId", parentId ?: JSONObject.NULL)
            .put("depth", depth)
            .put("packageName", node.packageName?.toString() ?: JSONObject.NULL)
            .put("className", node.className?.toString() ?: JSONObject.NULL)
            .put("resourceId", node.viewIdResourceName ?: JSONObject.NULL)
            .put(
                "text",
                when {
                    node.isPassword -> "[redacted]"
                    node.text != null -> node.text.toString()
                    else -> JSONObject.NULL
                }
            )
            .put(
                "contentDescription",
                node.contentDescription?.toString() ?: JSONObject.NULL
            )
            .put("password", node.isPassword)
            .put("clickable", node.isClickable)
            .put("longClickable", node.isLongClickable)
            .put("editable", node.isEditable)
            .put("scrollable", node.isScrollable)
            .put("enabled", node.isEnabled)
            .put("focused", node.isFocused)
            .put("selected", node.isSelected)
            .put("checked", node.isChecked)
            .put(
                "bounds",
                JSONObject()
                    .put("left", bounds.left)
                    .put("top", bounds.top)
                    .put("right", bounds.right)
                    .put("bottom", bounds.bottom)
            )
    }

    private fun nodeSummary(node: AccessibilityNodeInfo): JSONObject {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        return JSONObject()
            .put("packageName", node.packageName?.toString() ?: JSONObject.NULL)
            .put("className", node.className?.toString() ?: JSONObject.NULL)
            .put("resourceId", node.viewIdResourceName ?: JSONObject.NULL)
            .put("text", if (node.isPassword) "[redacted]" else node.text?.toString() ?: JSONObject.NULL)
            .put(
                "bounds",
                JSONObject()
                    .put("left", bounds.left)
                    .put("top", bounds.top)
                    .put("right", bounds.right)
                    .put("bottom", bounds.bottom)
            )
    }

    private fun requireCoordinates(x: Int, y: Int, width: Int, height: Int) {
        if (x !in 0 until width || y !in 0 until height) {
            throw CapabilityException(
                "invalid_request",
                "Gesture coordinates are outside the current display.",
                false
            )
        }
    }

    private fun <T> onMainThread(action: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return action()
        val latch = CountDownLatch(1)
        var result: Result<T>? = null
        Handler(Looper.getMainLooper()).post {
            result = runCatching(action)
            latch.countDown()
        }
        if (!latch.await(5, TimeUnit.SECONDS)) {
            throw CapabilityException(
                "execution_failed",
                "Android accessibility service did not respond.",
                true
            )
        }
        return result!!.getOrThrow()
    }

    private fun notifyCapabilityChanged() {
        sendBroadcast(Intent(ACTION_CAPABILITY_CHANGED).setPackage(packageName))
    }

    private data class QueuedNode(
        val node: AccessibilityNodeInfo,
        val depth: Int,
        val parentId: Int?
    )

    companion object {
        const val ACTION_CAPABILITY_CHANGED =
            "cloud.agentdevice.node.ACCESSIBILITY_CAPABILITY_CHANGED"

        @Volatile
        private var active: AdcAccessibilityService? = null

        fun isConnected(): Boolean = active != null

        fun inspect(maxDepth: Int, maxNodes: Int): JSONObject =
            requireService().inspect(maxDepth.coerceIn(1, 30), maxNodes.coerceIn(1, 1000))

        fun action(args: JSONObject): JSONObject = requireService().performAction(args)

        fun gesture(args: JSONObject): JSONObject = requireService().performGesture(args)

        fun navigation(action: String): JSONObject = requireService().performNavigation(action)

        private fun requireService(): AdcAccessibilityService =
            active ?: throw CapabilityException(
                "denied",
                "Enable ADC UI control in Android Accessibility settings.",
                false
            )
    }
}

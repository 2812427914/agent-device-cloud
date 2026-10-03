package cloud.agentdevice.node

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var store: NodeStore
    private lateinit var registry: CapabilityRegistry
    private lateinit var status: TextView
    private lateinit var capabilities: TextView
    private lateinit var urlInput: TextInputEditText
    private lateinit var codeInput: TextInputEditText
    private lateinit var labelInput: TextInputEditText
    private lateinit var pairButton: MaterialButton
    private lateinit var startButton: MaterialButton
    private lateinit var stopButton: MaterialButton

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            renderStatus(
                intent?.getBooleanExtra(NodeService.EXTRA_CONNECTED, false) == true,
                intent?.getStringExtra(NodeService.EXTRA_ERROR)
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = NodeStore(this)
        registry = CapabilityRegistry(this)
        setContentView(buildContent())
        bindState()
        ContextCompat.registerReceiver(
            this,
            statusReceiver,
            IntentFilter(NodeService.ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onResume() {
        super.onResume()
        AppVisibility.setForeground(true)
        renderCapabilities()
        renderStoredStatus()
    }

    override fun onPause() {
        AppVisibility.setForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        unregisterReceiver(statusReceiver)
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        renderCapabilities()
    }

    private fun buildContent(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xfff7f8fa.toInt())
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(36))
        }
        scroll.addView(
            root,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(text("ADC Mobile Node", 26f, Typeface.BOLD))
        root.addView(
            text(
                "Expose selected phone capabilities to authorized Agents. Android permissions remain the final boundary.",
                15f,
                Typeface.NORMAL
            ).withMargins(bottom = 20)
        )

        status = text("Not paired", 15f, Typeface.BOLD)
        root.addView(card(status).withMargins(bottom = 18))

        root.addView(sectionTitle("Pair this phone"))
        val urlField = input("ADC HTTPS URL", "https://devices.example.com")
        val codeField = input("Pairing code", "Create one from ADC Devices")
        val labelField = input(
            "Device name",
            defaultDeviceName()
        )
        urlInput = urlField.editText as TextInputEditText
        codeInput = codeField.editText as TextInputEditText
        labelInput = labelField.editText as TextInputEditText
        root.addView(urlField)
        root.addView(codeField.withMargins(top = 8))
        root.addView(labelField.withMargins(top = 8))
        pairButton = button("Pair and start") { pair() }
        root.addView(pairButton.withMargins(top = 12, bottom = 24))

        root.addView(sectionTitle("Node session"))
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        startButton = button("Start") { NodeService.start(this) }
        stopButton = button("Stop") { NodeService.stop(this) }
        controls.addView(
            startButton,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
        )
        controls.addView(
            stopButton,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(6) }
        )
        root.addView(controls.withMargins(bottom = 24))

        root.addView(sectionTitle("Phone permissions"))
        root.addView(
            text(
                "Location is intentionally available only while this screen is open. Background trip mode is not part of this MVP.",
                14f,
                Typeface.NORMAL
            ).withMargins(bottom = 10)
        )
        root.addView(button("Allow location") { requestLocation() })
        if (Build.VERSION.SDK_INT >= 33) {
            root.addView(button("Allow notifications") { requestNotifications() }.withMargins(top = 8))
        }

        root.addView(sectionTitle("Advertised capabilities").withMargins(top = 24))
        capabilities = text("", 14f, Typeface.NORMAL)
        root.addView(card(capabilities))

        root.addView(
            button("Forget local pairing") { confirmForget() }.withMargins(top = 24)
        )
        return scroll
    }

    private fun bindState() {
        val config = store.config()
        if (config != null) {
            urlInput.setText(config.controlPlaneUrl)
            labelInput.setText(config.label)
            codeInput.setText("")
        } else {
            labelInput.setText(
                defaultDeviceName()
            )
        }
        pairButton.isEnabled = config == null
        startButton.isEnabled = config != null
        stopButton.isEnabled = config != null
        renderStoredStatus()
        renderCapabilities()
    }

    private fun pair() {
        val url = urlInput.text?.toString()?.trim()?.trimEnd('/').orEmpty()
        val code = codeInput.text?.toString()?.trim().orEmpty()
        val label = labelInput.text?.toString()?.trim().orEmpty()
        val uri =
            try {
                URI(url)
            } catch (_: Exception) {
                null
            }
        if (uri?.scheme != "https" || uri.host.isNullOrBlank()) {
            showError("Use the HTTPS origin shown by your ADC installation.")
            return
        }
        if (code.length < 8 || label.isBlank()) {
            showError("Enter a valid pairing code and device name.")
            return
        }
        pairButton.isEnabled = false
        status.setText(R.string.node_pairing)
        executor.execute {
            try {
                val config = NodeProtocol(store).pair(url, code, label)
                store.saveConfig(config)
                runOnUiThread {
                    codeInput.setText("")
                    bindState()
                    NodeService.start(this)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    pairButton.isEnabled = true
                    showError(error.message ?: "Pairing failed.")
                    renderStoredStatus()
                }
            }
        }
    }

    private fun requestLocation() {
        requestPermissions(
            arrayOf(
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            ),
            REQUEST_LOCATION
        )
    }

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    private fun confirmForget() {
        if (store.config() == null) return
        MaterialAlertDialogBuilder(this)
            .setTitle("Forget this pairing?")
            .setMessage(
                "This removes the phone identity locally. The old device remains offline in ADC until you remove it there."
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Forget") { _, _ ->
                NodeService.stop(this)
                try {
                    store.clearConfig()
                    bindState()
                } catch (error: Exception) {
                    showError(error.message ?: "Unable to remove the local pairing.")
                }
            }
            .show()
    }

    private fun renderStoredStatus() {
        val config = store.config()
        if (config == null) {
            status.setText(R.string.node_not_paired)
            return
        }
        val error = store.lastError()
        status.text =
            if (error != null) {
                "${config.label}\nDisconnected: $error"
            } else {
                "${config.label}\nLast connected: ${store.lastSeenAt() ?: "not yet"}"
            }
    }

    private fun renderStatus(connected: Boolean, error: String?) {
        val config = store.config()
        status.text =
            when {
                config == null -> "Not paired"
                connected -> "${config.label}\nConnected to ${config.controlPlaneUrl}"
                else -> "${config.label}\n${error ?: "Disconnected"}"
            }
        renderCapabilities()
    }

    private fun renderCapabilities() {
        val nodeId = store.config()?.nodeId ?: "node_pending"
        val tools = registry.manifest(nodeId).getJSONArray("tools")
        val lines = buildList {
            for (index in 0 until tools.length()) {
                val tool = tools.getJSONObject(index)
                val availability = tool.getJSONObject("availability")
                add(
                    "${tool.getString("name")}\n" +
                        "  ${availability.getString("state")}" +
                        availability.optString("reason")
                            .takeIf(String::isNotBlank)
                            ?.let { " · $it" }
                            .orEmpty()
                )
            }
        }
        capabilities.text = lines.joinToString("\n\n")
    }

    private fun showError(message: String) {
        MaterialAlertDialogBuilder(this)
            .setTitle("Unable to continue")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun input(label: String, hint: String): TextInputLayout {
        val edit = TextInputEditText(this).apply {
            this.hint = hint
            setSingleLine(true)
        }
        return TextInputLayout(this).apply {
            this.hint = label
            addView(
                edit,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }
    }

    private fun button(label: String, action: () -> Unit): MaterialButton =
        MaterialButton(this).apply {
            text = label
            setOnClickListener { action() }
        }

    private fun sectionTitle(value: String): TextView =
        text(value, 17f, Typeface.BOLD).withMargins(bottom = 10)

    private fun text(value: String, size: Float, style: Int): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            setTypeface(typeface, style)
            setTextColor(0xff172033.toInt())
            setLineSpacing(0f, 1.12f)
        }

    private fun card(content: TextView): MaterialCardView =
        MaterialCardView(this).apply {
            radius = dp(8).toFloat()
            strokeWidth = dp(1)
            strokeColor = 0xffd8dde8.toInt()
            setCardBackgroundColor(0xffffffff.toInt())
            content.setPadding(dp(16), dp(14), dp(16), dp(14))
            addView(content)
        }

    private fun <T : android.view.View> T.withMargins(
        left: Int = 0,
        top: Int = 0,
        right: Int = 0,
        bottom: Int = 0
    ): T {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(dp(left), dp(top), dp(right), dp(bottom))
        }
        return this
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun defaultDeviceName(): String =
        getString(
            R.string.default_device_name,
            Build.MANUFACTURER.replaceFirstChar(Char::uppercase),
            Build.MODEL
        )

    companion object {
        private const val REQUEST_LOCATION = 101
        private const val REQUEST_NOTIFICATIONS = 102
    }
}

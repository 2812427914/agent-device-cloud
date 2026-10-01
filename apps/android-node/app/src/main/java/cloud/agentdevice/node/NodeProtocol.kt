package cloud.agentdevice.node

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.Signature
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

class NodeProtocol(
    private val store: NodeStore
) {
    fun pair(controlPlaneUrl: String, code: String, label: String): NodeConfig {
        val body = JSONObject()
            .put("code", code)
            .put("label", label)
            .put("platform", "android")
            .put("publicKey", store.publicKeyPem())
        val response = post("$controlPlaneUrl/api/v1/nodes/pair", body, emptyMap())
        return NodeConfig(
            controlPlaneUrl.trimEnd('/'),
            response.getString("nodeId"),
            response.getString("accountId"),
            label
        )
    }

    fun poll(config: NodeConfig, capability: JSONObject): JSONObject {
        val body = JSONObject()
            .put("capability", capability)
            .put("activeTaskCount", 0)
            .put("claim", true)
        return signedPost(config, "/api/v1/nodes/${config.nodeId}/poll", body)
    }

    fun acknowledge(config: NodeConfig, dispatchId: String, leaseToken: String): JSONObject =
        signedPost(
            config,
            "/api/v1/nodes/${config.nodeId}/ack",
            JSONObject().put("dispatchId", dispatchId).put("leaseToken", leaseToken)
        )

    fun renewLease(config: NodeConfig, dispatchId: String, leaseToken: String): JSONObject =
        signedPost(
            config,
            "/api/v1/nodes/${config.nodeId}/leases/renew",
            JSONObject().put("dispatchId", dispatchId).put("leaseToken", leaseToken)
        )

    fun complete(
        config: NodeConfig,
        dispatchId: String,
        leaseToken: String,
        result: JSONObject
    ): JSONObject =
        signedPost(
            config,
            "/api/v1/nodes/${config.nodeId}/receipts",
            JSONObject()
                .put("dispatchId", dispatchId)
                .put("leaseToken", leaseToken)
                .put("result", result)
                .apply {
                    result.optJSONObject("receipt")?.let { put("receipt", it) }
                }
        )

    private fun signedPost(config: NodeConfig, path: String, body: JSONObject): JSONObject {
        val timestamp = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        val nonceBytes = ByteArray(18)
        java.security.SecureRandom().nextBytes(nonceBytes)
        val nonce = Base64.encodeToString(
            nonceBytes,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        )
        val payload = requestPayload("POST", path, timestamp, nonce, body)
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(store.privateKey())
        signer.update(payload.toByteArray(StandardCharsets.UTF_8))
        val signature = Base64.encodeToString(
            signer.sign(),
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        )
        return post(
            "${config.controlPlaneUrl}$path",
            body,
            mapOf(
                "x-adc-node-id" to config.nodeId,
                "x-adc-timestamp" to timestamp,
                "x-adc-nonce" to nonce,
                "x-adc-signature" to signature
            )
        )
    }

    private fun post(url: String, body: JSONObject, headers: Map<String, String>): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.doOutput = true
        connection.setRequestProperty("content-type", "application/json")
        connection.setRequestProperty("accept", "application/json")
        headers.forEach(connection::setRequestProperty)
        connection.outputStream.use {
            it.write(body.toString().toByteArray(StandardCharsets.UTF_8))
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
        connection.disconnect()
        val response = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (status !in 200..299) {
            val error = response.optJSONObject("error")
            throw NodeApiException(
                status,
                error?.optString("code", "internal") ?: "internal",
                error?.optString("message", "ADC returned HTTP $status")
                    ?: "ADC returned HTTP $status"
            )
        }
        return response
    }

    companion object {
        internal fun requestPayload(
            method: String,
            path: String,
            timestamp: String,
            nonce: String,
            body: Any?
        ): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(canonicalJson(body).toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            return "${method.uppercase()}\n$path\n$timestamp\n$nonce\n$digest"
        }

        internal fun canonicalJson(value: Any?): String =
            when (value) {
                null, JSONObject.NULL -> "null"
                is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(
                    separator = ",",
                    prefix = "{",
                    postfix = "}"
                ) { key -> "${JSONObject.quote(key)}:${canonicalJson(value.get(key))}" }
                is JSONArray -> (0 until value.length()).joinToString(
                    separator = ",",
                    prefix = "[",
                    postfix = "]"
                ) { index -> canonicalJson(value.get(index)) }
                is String -> JSONObject.quote(value)
                is Number -> canonicalNumber(value)
                is Boolean -> value.toString()
                else -> JSONObject.quote(value.toString())
            }

        internal fun canonicalNumber(value: Number): String {
            val number = value.toString().toDouble()
            require(number.isFinite()) { "JSON numbers must be finite" }
            if (number == 0.0) return "0"

            val sign = if (number < 0) "-" else ""
            val decimal = BigDecimal.valueOf(kotlin.math.abs(number)).stripTrailingZeros()
            val digits = decimal.unscaledValue().abs().toString()
            val decimalPoint = digits.length - decimal.scale()
            val encoded =
                when {
                    decimalPoint in 1..21 ->
                        if (digits.length <= decimalPoint) {
                            digits + "0".repeat(decimalPoint - digits.length)
                        } else {
                            "${digits.take(decimalPoint)}.${digits.drop(decimalPoint)}"
                        }
                    decimalPoint in -5..0 ->
                        "0.${"0".repeat(-decimalPoint)}$digits"
                    else -> {
                        val exponent = decimalPoint - 1
                        buildString {
                            append(digits.first())
                            if (digits.length > 1) append('.').append(digits.drop(1))
                            append('e')
                            if (exponent >= 0) append('+')
                            append(exponent)
                        }
                    }
                }
            return sign + encoded
        }

        fun invocationId(prefix: String): String =
            "${prefix}_${UUID.randomUUID().toString().replace("-", "").lowercase()}"
    }
}

class NodeApiException(
    val statusCode: Int,
    val code: String,
    override val message: String
) : Exception(message)

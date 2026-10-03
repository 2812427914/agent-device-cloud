package cloud.agentdevice.node

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeFormatter

class MobileExecutionEngine(
    private val store: NodeStore,
    private val registry: CapabilityRegistry
) {
    fun execute(
        nodeId: String,
        dispatch: JSONObject,
        cancelled: () -> Boolean = { false }
    ): MobileExecutionResult {
        val invocation = dispatch.getJSONObject("invocation")
        val policy = dispatch.getJSONObject("policyDecision")
        val startedAt = Instant.now()
        val tool = invocation.getString("tool")
        val args = invocation.optJSONObject("args") ?: JSONObject()
        val sideEffect = tool in SIDE_EFFECT_TOOLS
        val argsHash = sha256(args)

        if (policy.getString("outcome") != "allow") {
            return MobileExecutionResult(
                result(
                    nodeId,
                    invocation,
                    policy,
                    "denied",
                    startedAt,
                    argsHash,
                    null,
                    error("denied", policy.optString("explanation", "Operation denied."), false),
                    sideEffect,
                    false
                )
            )
        }
        val target = invocation.getJSONObject("target")
        if (target.has("nodeId") && target.getString("nodeId") != nodeId) {
            return MobileExecutionResult(
                result(
                    nodeId,
                    invocation,
                    policy,
                    "denied",
                    startedAt,
                    argsHash,
                    null,
                    error("denied", "Invocation targets a different device.", false),
                    sideEffect,
                    false
                )
            )
        }

        val ledger =
            try {
                if (sideEffect) beginIdempotent(invocation, tool, args) else null
            } catch (exception: CapabilityException) {
                return MobileExecutionResult(
                    result(
                        nodeId,
                        invocation,
                        policy,
                        if (exception.code == "unknown_outcome") "unknown_outcome" else "failed",
                        startedAt,
                        argsHash,
                        null,
                        error(exception.code, exception.message, exception.retryable),
                        sideEffect,
                        false
                    )
                )
            }
        if (ledger?.replay != null) {
            return MobileExecutionResult(replay(ledger.replay, invocation))
        }
        if (ledger?.unknown == true) {
            return MobileExecutionResult(
                result(
                    nodeId,
                    invocation,
                    policy,
                    "unknown_outcome",
                    startedAt,
                    argsHash,
                    null,
                    error(
                        "unknown_outcome",
                        "A prior attempt started without a durable terminal result.",
                        false
                    ),
                    sideEffect,
                    false
                )
            )
        }

        if (Instant.parse(invocation.getString("expiresAt")).isBefore(Instant.now())) {
            return MobileExecutionResult(
                completeLedger(
                    ledger,
                    result(
                        nodeId,
                        invocation,
                        policy,
                        "failed",
                        startedAt,
                        argsHash,
                        null,
                        error("expired", "Invocation expired before mobile execution.", false),
                        sideEffect,
                        false
                    ),
                    nodeId,
                    invocation,
                    policy,
                    startedAt,
                    argsHash,
                    sideEffect
                )
            )
        }
        if (cancelled()) {
            return MobileExecutionResult(
                completeLedger(
                    ledger,
                    result(
                        nodeId,
                        invocation,
                        policy,
                        "cancelled",
                        startedAt,
                        argsHash,
                        null,
                        error("cancelled", "Invocation was cancelled.", false),
                        sideEffect,
                        false
                    ),
                    nodeId,
                    invocation,
                    policy,
                    startedAt,
                    argsHash,
                    sideEffect
                )
            )
        }

        var artifacts = emptyList<MobileArtifact>()
        val completed =
            try {
                val capability = registry.execute(tool, args, cancelled)
                artifacts = capability.artifacts
                result(
                    nodeId,
                    invocation,
                    policy,
                    "succeeded",
                    startedAt,
                    argsHash,
                    capability.output,
                    null,
                    sideEffect,
                    false,
                    artifacts.map(MobileArtifact::artifactId)
                )
            } catch (exception: CapabilityException) {
                result(
                    nodeId,
                    invocation,
                    policy,
                    when (exception.code) {
                        "denied" -> "denied"
                        "cancelled" -> "cancelled"
                        "unknown_outcome" -> "unknown_outcome"
                        else -> "failed"
                    },
                    startedAt,
                    argsHash,
                    null,
                    error(exception.code, exception.message, exception.retryable),
                    sideEffect,
                    false
                )
            } catch (_: Exception) {
                result(
                    nodeId,
                    invocation,
                    policy,
                    "failed",
                    startedAt,
                    argsHash,
                    null,
                    error(
                        "execution_failed",
                        "Mobile capability failed; inspect the phone for its current state.",
                        true
                    ),
                    sideEffect,
                    false
                )
            }
        return MobileExecutionResult(
            completeLedger(
                ledger,
                completed,
                nodeId,
                invocation,
                policy,
                startedAt,
                argsHash,
                sideEffect
            ),
            artifacts
        )
    }

    private fun beginIdempotent(
        invocation: JSONObject,
        tool: String,
        args: JSONObject
    ): LedgerState {
        val key = invocation.optString("idempotencyKey")
        if (key.isBlank()) {
            throw CapabilityException(
                "invalid_request",
                "Side-effecting mobile capabilities require an idempotency key.",
                false
            )
        }
        val scope = "${invocation.getString("accountId")}:${invocation.getJSONObject("actor").getString("id")}"
        val keyHash = sha256Text("$scope:$key").removePrefix("sha256:")
        val inputHash = sha256(
            JSONObject()
                .put("tool", tool)
                .put("args", args)
                .put("target", invocation.getJSONObject("target"))
        )
        val existing = store.readIdempotency(keyHash)
        if (existing != null) {
            val entry = JSONObject(existing)
            if (entry.getString("inputHash") != inputHash) {
                throw CapabilityException(
                    "conflict",
                    "Idempotency key was already used with different input.",
                    false
                )
            }
            return if (entry.getString("state") == "completed") {
                LedgerState(keyHash, inputHash, replay = entry.getJSONObject("result"))
            } else {
                LedgerState(keyHash, inputHash, unknown = true)
            }
        }
        val started = JSONObject()
            .put("state", "started")
            .put("inputHash", inputHash)
            .put("invocationId", invocation.getString("invocationId"))
            .put("startedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
            .put("updatedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
        if (!store.writeIdempotency(keyHash, started.toString())) {
            throw CapabilityException("internal", "Unable to save idempotency state.", true)
        }
        return LedgerState(keyHash, inputHash)
    }

    private fun completeLedger(
        ledger: LedgerState?,
        completed: JSONObject,
        nodeId: String,
        invocation: JSONObject,
        policy: JSONObject,
        startedAt: Instant,
        argsHash: String,
        sideEffect: Boolean
    ): JSONObject {
        if (ledger == null) return completed
        val stored = JSONObject()
            .put("state", "completed")
            .put("inputHash", ledger.inputHash)
            .put("updatedAt", DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
            .put("result", completed)
        if (store.writeIdempotency(ledger.keyHash, stored.toString())) return completed
        return result(
            nodeId,
            invocation,
            policy,
            "unknown_outcome",
            startedAt,
            argsHash,
            null,
            error(
                "unknown_outcome",
                "The action finished but its durable result could not be saved.",
                false
            ),
            sideEffect,
            false
        )
    }

    private fun replay(saved: JSONObject, invocation: JSONObject): JSONObject {
        val replay = JSONObject(saved.toString())
            .put("invocationId", invocation.getString("invocationId"))
            .put("attemptId", invocation.getString("attemptId"))
        replay.optJSONObject("receipt")
            ?.put("invocationId", invocation.getString("invocationId"))
            ?.put("attemptId", invocation.getString("attemptId"))
            ?.put("replayed", true)
        return replay
    }

    private fun result(
        nodeId: String,
        invocation: JSONObject,
        policy: JSONObject,
        status: String,
        startedAt: Instant,
        argsHash: String,
        output: JSONObject?,
        error: JSONObject?,
        sideEffect: Boolean,
        replayed: Boolean,
        artifactRefs: List<String> = emptyList()
    ): JSONObject {
        val completedAt = Instant.now()
        val receipt = JSONObject()
            .put("schemaVersion", "0.1")
            .put("receiptId", NodeProtocol.invocationId("rcpt"))
            .put("invocationId", invocation.getString("invocationId"))
            .put("attemptId", invocation.getString("attemptId"))
            .put("nodeId", nodeId)
            .put("tool", invocation.getString("tool"))
            .put("terminalStatus", status)
            .put("sideEffect", sideEffect)
            .put("replayed", replayed)
            .put("argsHash", argsHash)
            .put("policyDecisionHash", policy.getString("decisionHash"))
            .put("startedAt", DateTimeFormatter.ISO_INSTANT.format(startedAt))
            .put("completedAt", DateTimeFormatter.ISO_INSTANT.format(completedAt))
            .put(
                "durationMs",
                (completedAt.toEpochMilli() - startedAt.toEpochMilli()).coerceAtLeast(0)
            )
            .put("artifactRefs", JSONArray(artifactRefs))
        invocation.optString("idempotencyKey")
            .takeIf(String::isNotBlank)
            ?.let { receipt.put("idempotencyKeyHash", sha256Text(it)) }
        if (output != null) receipt.put("outputHash", sha256(output))

        return JSONObject()
            .put("schemaVersion", "0.1")
            .put("invocationId", invocation.getString("invocationId"))
            .put("attemptId", invocation.getString("attemptId"))
            .put("status", status)
            .apply {
                if (output != null) put("output", output)
                if (error != null) put("error", error)
            }
            .put("receipt", receipt)
    }

    private fun error(code: String, message: String, retryable: Boolean): JSONObject =
        JSONObject()
            .put("code", code)
            .put("message", message)
            .put("retryable", retryable)

    companion object {
        private val SIDE_EFFECT_TOOLS = setOf(
            "notification.show",
            "ui.action",
            "ui.gesture",
            "device.navigation"
        )

        fun sha256(value: Any?): String = sha256Text(NodeProtocol.canonicalJson(value))

        private fun sha256Text(value: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(value.toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            return "sha256:$digest"
        }
    }

    private data class LedgerState(
        val keyHash: String,
        val inputHash: String,
        val replay: JSONObject? = null,
        val unknown: Boolean = false
    )
}

package cloud.agentdevice.node

import org.json.JSONObject

data class MobileArtifact(
    val artifactId: String,
    val contentType: String,
    val sha256: String,
    val data: ByteArray
)

data class MobileCapabilityResult(
    val output: JSONObject,
    val artifacts: List<MobileArtifact> = emptyList()
)

data class MobileExecutionResult(
    val result: JSONObject,
    val artifacts: List<MobileArtifact> = emptyList()
)

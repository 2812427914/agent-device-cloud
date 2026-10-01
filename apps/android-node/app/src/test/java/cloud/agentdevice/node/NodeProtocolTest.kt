package cloud.agentdevice.node

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NodeProtocolTest {
    @Test
    fun canonicalJsonMatchesControlPlaneOrdering() {
        val value = JSONObject()
            .put("b", 2)
            .put(
                "a",
                JSONObject()
                    .put("z", true)
                    .put("y", JSONArray().put("x").put(JSONObject.NULL))
            )

        assertEquals(
            """{"a":{"y":["x",null],"z":true},"b":2}""",
            NodeProtocol.canonicalJson(value)
        )
        assertEquals(
            "sha256:e1c4eb1b358344b9f58ff65ea5ef3f986a5086b4b1c389720f01658640f70f59",
            MobileExecutionEngine.sha256(value)
        )
    }

    @Test
    fun canonicalNumbersMatchJavaScriptJsonStringify() {
        val vectors = listOf(
            1e-7 to "1e-7",
            1e-6 to "0.000001",
            1e20 to "100000000000000000000",
            1e21 to "1e+21",
            0.0001234 to "0.0001234",
            -0.0 to "0",
            1.2345678901234567 to "1.2345678901234567",
            -123.45 to "-123.45"
        )

        vectors.forEach { (value, expected) ->
            assertEquals(expected, NodeProtocol.canonicalNumber(value))
        }
    }

    @Test
    fun requestPayloadMatchesTheFiveLineNodeProofContract() {
        val body = JSONObject().put("claim", true).put("activeTaskCount", 0)
        val payload = NodeProtocol.requestPayload(
            "post",
            "/api/v1/nodes/node_example/poll",
            "2026-10-01T00:00:00Z",
            "abcdefghijklmnop",
            body
        )

        assertEquals(5, payload.lines().size)
        assertEquals("POST", payload.lineSequence().first())
        assertEquals(
            "/api/v1/nodes/node_example/poll",
            payload.lineSequence().drop(1).first()
        )
    }
}

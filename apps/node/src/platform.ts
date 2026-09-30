import { NodePlatformSchema, type NodePlatform } from "@adc/protocol";

export function nodePlatform(platform: NodeJS.Platform = process.platform): NodePlatform {
  const parsed = NodePlatformSchema.safeParse(platform);
  if (!parsed.success) throw new Error(`Unsupported device platform: ${platform}`);
  return parsed.data;
}
